//! Native loading strip for remote Windows webviews, outside the site DOM.
use std::{cell::Cell, ffi::c_void, rc::Rc};
use tauri::Webview;
use webview2_com::{
    ExecuteScriptCompletedHandler, NavigationCompletedEventHandler, NavigationStartingEventHandler,
};

type Handle = *mut c_void;
const CONTROL_ID: isize = 0x7f31;
#[repr(C)]
struct CommonControls {
    size: u32,
    classes: u32,
}
#[repr(C)]
#[derive(Default)]
struct ClientRect {
    left: i32,
    top: i32,
    right: i32,
    bottom: i32,
}
#[link(name = "comctl32")]
extern "system" {
    fn InitCommonControlsEx(value: *const CommonControls) -> i32;
}
#[link(name = "user32")]
extern "system" {
    fn GetClientRect(window: Handle, rect: *mut ClientRect) -> i32;
    fn GetDpiForWindow(window: Handle) -> u32;
    fn CreateWindowExW(
        ex: u32,
        class: *const u16,
        title: *const u16,
        style: u32,
        x: i32,
        y: i32,
        width: i32,
        height: i32,
        parent: Handle,
        menu: Handle,
        instance: Handle,
        param: Handle,
    ) -> Handle;
    fn GetDlgItem(parent: Handle, id: i32) -> Handle;
    fn SendMessageW(window: Handle, message: u32, wparam: usize, lparam: isize) -> isize;
    fn ShowWindow(window: Handle, command: i32) -> i32;
    fn SetWindowPos(
        window: Handle,
        after: Handle,
        x: i32,
        y: i32,
        width: i32,
        height: i32,
        flags: u32,
    ) -> i32;
}

unsafe fn loading(control: Handle, active: bool) {
    SendMessageW(control, 0x40a, usize::from(active), 25); // PBM_SETMARQUEE
    ShowWindow(control, if active { 5 } else { 0 });
}

pub fn update(webview: &Webview) -> tauri::Result<()> {
    webview.with_webview(move |platform| unsafe {
        // Use native APIs on this UI callback. Dispatching Tauri window queries
        // from inside with_webview can wait on the callback's own event loop.
        let mut parent_window = Default::default();
        if platform
            .controller()
            .ParentWindow(&mut parent_window)
            .is_err()
        {
            return;
        }
        let parent = parent_window.0 as Handle;
        let mut size = ClientRect::default();
        if GetClientRect(parent, &mut size) == 0 {
            return;
        }
        let height = (3 * GetDpiForWindow(parent).max(96) / 96) as i32;
        let mut control = GetDlgItem(parent, CONTROL_ID as i32);
        if control.is_null() {
            InitCommonControlsEx(&CommonControls {
                size: std::mem::size_of::<CommonControls>() as u32,
                classes: 0x20,
            });
            let class: Vec<u16> = "msctls_progress32\0".encode_utf16().collect();
            control = CreateWindowExW(
                0,
                class.as_ptr(),
                std::ptr::null(),
                0x50000008,
                0,
                0,
                size.right,
                height,
                parent,
                CONTROL_ID as Handle,
                std::ptr::null_mut(),
                std::ptr::null_mut(),
            );
            if control.is_null() {
                return;
            }
            let bar = control as isize;
            loading(control, true);
            if let Ok(core) = platform.controller().CoreWebView2() {
                let mut token = 0;
                let navigation = Rc::new(Cell::new(0u64));
                let current = navigation.clone();
                let _ = core.add_NavigationStarting(
                    &NavigationStartingEventHandler::create(Box::new(move |_, args| {
                        if let Some(args) = args {
                            let mut id = 0;
                            args.NavigationId(&mut id)?;
                            current.set(id);
                        }
                        loading(bar as Handle, true);
                        Ok(())
                    })),
                    &mut token,
                );
                let current = navigation.clone();
                let _ = core.add_NavigationCompleted(
                    &NavigationCompletedEventHandler::create(Box::new(move |_, args| {
                        if let Some(args) = args {
                            let mut id = 0;
                            args.NavigationId(&mut id)?;
                            if current.get() != 0 && current.get() != id {
                                return Ok(());
                            }
                        }
                        loading(bar as Handle, false);
                        Ok(())
                    })),
                    &mut token,
                );
                // A cached page can complete before the frontend receives its
                // window-created event. Avoid leaving its loading strip stuck.
                let script: Vec<u16> = "document.readyState\0".encode_utf16().collect();
                let _ = core.ExecuteScript(
                    windows_core::PCWSTR(script.as_ptr()),
                    &ExecuteScriptCompletedHandler::create(Box::new(move |status, result| {
                        if navigation.get() == 0 && status.is_ok() && result == "\"complete\"" {
                            loading(bar as Handle, false);
                        }
                        Ok(())
                    })),
                );
            }
        }
        SetWindowPos(
            control,
            std::ptr::null_mut(),
            0,
            0,
            size.right,
            height,
            0x14,
        );
        let controller = platform.controller();
        let mut bounds = Default::default();
        if controller.Bounds(&mut bounds).is_ok() {
            bounds.left = 0;
            bounds.top = height;
            bounds.right = size.right;
            bounds.bottom = size.bottom;
            let _ = controller.SetBounds(bounds);
        }
    })
}

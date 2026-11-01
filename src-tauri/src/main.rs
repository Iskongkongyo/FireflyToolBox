#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    if std::env::args().nth(1).as_deref() == Some("--firefly-module-worker") {
        firefly_toolbox_lib::run_module_worker();
        return;
    }
    #[cfg(target_os = "windows")]
    if let Some(code) =
        firefly_toolbox_lib::run_package_command(&std::env::args_os().skip(1).collect::<Vec<_>>())
    {
        std::process::exit(code);
    }
    firefly_toolbox_lib::run();
}

use crate::modules;
use std::collections::BTreeMap;

macro_rules! unavailable {
    ($name:ident($($arg:ident: $kind:ty),*) -> $result:ty) => {
        #[tauri::command]
        #[allow(unused_variables)]
        pub fn $name($($arg: $kind),*) -> Result<$result,String> {Err("当前平台尚未开放第三方工具包。".into())}
    };
}
unavailable!(inspect_module_file(path:String)->modules::ModuleSummary);
unavailable!(install_module_file(path:String)->modules::ModuleSummary);
unavailable!(export_module_file(module_id:String,path:String)->());
unavailable!(validate_module_draft(manifest:modules::Manifest,scripts:BTreeMap<String,String>,resource_module_id:Option<String>,resource_draft_id:Option<String>)->modules::ModuleSummary);
unavailable!(install_module_draft(manifest:modules::Manifest,scripts:BTreeMap<String,String>,resource_module_id:Option<String>,resource_draft_id:Option<String>)->modules::ModuleSummary);
unavailable!(export_module_draft_file(manifest:modules::Manifest,scripts:BTreeMap<String,String>,resource_module_id:Option<String>,resource_draft_id:Option<String>,path:String)->());
unavailable!(read_module_resource(module_id:String,path:String,offset:u64,length:usize,expected_sha256:Option<String>,resource_draft_id:Option<String>)->tauri::ipc::Response);
unavailable!(stage_module_resource(path:String,resource_draft_id:String)->modules::Resource);
unavailable!(discard_module_resources(resource_draft_id:String,path:Option<String>)->());

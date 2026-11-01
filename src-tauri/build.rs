fn main() {
    // NDK 26 does not default to 16 KiB ELF/RELRO alignment. Set both flags
    // on the final Android library without changing dependency compilation.
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("android") {
        println!("cargo:rustc-link-arg=-Wl,-z,max-page-size=16384");
        println!("cargo:rustc-link-arg=-Wl,-z,common-page-size=16384");
    }
    println!("cargo:rerun-if-env-changed=FIREFLY_MESSAGES_URL");
    println!("cargo:rerun-if-env-changed=FIREFLY_REPOSITORY_TEST_URL");
    println!("cargo:rerun-if-changed=remote-messages.json");
    tauri_build::build()
}

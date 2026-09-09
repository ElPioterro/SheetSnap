# Bundled per-platform binaries

Drop platform-specific tool binaries here before packaging. They are copied
into the installed app's `resources/bin/` via electron-builder `extraResources`
and wired up by `electron/main.cjs`.

## yt-dlp (optional — enables the YouTube source tab)

Download the official binary for the OS you are building for and place it here:

- Windows: `yt-dlp.exe`
- macOS / Linux: `yt-dlp`  (`chmod +x yt-dlp`)

Source: https://github.com/yt-dlp/yt-dlp/releases

If no binary is present, the app still runs — file upload works, and the
YouTube tab shows a clear "yt-dlp not available" message (the server falls
back to a `yt-dlp` on the system PATH if one exists).

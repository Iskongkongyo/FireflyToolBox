// src-tauri/builtin-tools/src/common.js
var $ = (id) => document.getElementById(id);
function status(text, error = false) {
  $("status").textContent = text;
  $("status").classList.toggle("error", error);
}
function size(value) {
  if (value < 1024) return `${value} B`;
  if (value < 1048576) return `${(value / 1024).toFixed(1)} KiB`;
  return `${(value / 1048576).toFixed(2)} MiB`;
}

// src-tauri/builtin-tools/src/media-job.js
function workerRequest(worker, data, { signal, report = () => {
}, onLog = () => {
} } = {}, transfer = []) {
  return new Promise((resolve, reject) => {
    const finish = (error, result) => {
      worker.onmessage = worker.onerror = null;
      signal?.removeEventListener("abort", abort);
      error ? reject(error) : resolve(result);
    };
    const abort = () => finish(new DOMException("任务已取消。", "AbortError"));
    if (signal?.aborted) {
      abort();
      return;
    }
    signal?.addEventListener("abort", abort, { once: true });
    worker.onerror = () => finish(new Error("转换引擎启动失败或设备内存不足。"));
    worker.onmessage = ({ data: data2 }) => {
      if (data2.type === "progress") report(data2.value);
      else if (data2.type === "log") onLog(data2.message);
      else if (data2.type === "error") finish(new Error(data2.message));
      else if (data2.type === "done") finish(null, data2);
    };
    worker.postMessage(data, transfer);
  });
}
function outputName(name, suffix, extension) {
  return name.replace(/\.[^.]*$/, "").slice(0, 80) + suffix + "." + extension;
}

// src-tauri/builtin-tools/src/media-task.js
async function mediaTask(context, resources, input, mode, options = {}, writer) {
  const coreUrl = await resources.url("engine/ffmpeg-core.js", { signal: context.signal }), wasm = await (await resources.blob("engine/ffmpeg-core.wasm", { signal: context.signal })).arrayBuffer(), worker = await context.worker("engine/media-worker.js");
  return workerRequest(worker, { coreUrl, wasm, mode, options, extension: input.name.match(/\.([a-z0-9]{1,10})$/i)?.[1].toLowerCase() ?? "bin", input: { url: input.url, size: input.size }, ...writer ? { output: { url: writer.workspaceUrl, size: 0 } } : {} }, context, [wasm]);
}
async function seekableFile(file, files, signal) {
  if (file.seekable && file.url) return file;
  const writer = await files.createWriter(file.name.slice(0, 120));
  try {
    await writer.write(file.stream({ signal }), { signal });
    const reader = await writer.preview({ signal });
    await writer.abort();
    await file.close();
    return reader;
  } catch (error) {
    await writer.abort();
    await file.close();
    throw error;
  }
}

// src-tauri/builtin-tools/src/media-plan.js
var videoFormats = { mp4: ["libx264", "aac"], webm: ["libvpx", "libopus"], mkv: ["libx264", "aac"], mov: ["libx264", "aac"], avi: ["mpeg4", "libmp3lame"] };
var audioFormats = { mp3: ["libmp3lame", "audio/mpeg"], m4a: ["aac", "audio/mp4"], wav: ["pcm_s16le", "audio/wav"], flac: ["flac", "audio/flac"], ogg: ["libvorbis", "audio/ogg"], opus: ["libopus", "audio/ogg"] };
function parseTime(value) {
  const text = String(value ?? "").trim();
  if (!text) throw new Error("请输入时间。");
  const parts = text.split(":");
  if (parts.length > 3 || parts.some((part) => !/^\d+(?:\.\d+)?$/.test(part)) || parts.slice(1).some((part) => Number(part) >= 60)) throw new Error("时间格式须为秒数或 HH:MM:SS。");
  const result = parts.reduce((sum, part) => sum * 60 + Number(part), 0);
  if (!Number.isFinite(result) || result > 86400) throw new Error("时间须在 0～24 小时内。");
  return result;
}
function speedFilter(rate, keepPitch = true) {
  rate = Number(rate);
  if (!Number.isFinite(rate) || rate < 0.25 || rate > 4) throw new Error("倍速须在 0.25～4 之间。");
  if (!keepPitch) return `aresample=48000,asetrate=${48e3 * rate},aresample=48000`;
  const parts = [];
  while (rate > 2) {
    parts.push("atempo=2");
    rate /= 2;
  }
  while (rate < 0.5) {
    parts.push("atempo=0.5");
    rate /= 0.5;
  }
  parts.push(`atempo=${rate}`);
  return parts.join(",");
}
function plan(mode, options, input = "input.mp4", output = "output.mp4") {
  const quality = options.quality ?? "balanced", resolution = Number(options.resolution ?? 720), fps = Number(options.fps ?? 15);
  if (!["high", "balanced", "small"].includes(quality) || ![0, 1080, 720, 480, 360, 240].includes(resolution)) throw new Error("清晰度或质量无效。");
  const crf = { high: 20, balanced: 26, small: 32 }[quality], bitrate = { high: "192k", balanced: "128k", small: "96k" }[quality];
  const scale = resolution ? `scale=w='if(gte(iw,ih),min(iw,${Math.round(resolution * 16 / 9)}),min(iw,${resolution}))':h='if(gte(iw,ih),min(ih,${resolution}),min(ih,${Math.round(resolution * 16 / 9)}))':force_original_aspect_ratio=decrease:force_divisible_by=2,setsar=1` : "scale=trunc(iw/2)*2:trunc(ih/2)*2,setsar=1";
  const args = ["-hide_banner", "-loglevel", "info", "-threads", "1", "-filter_threads", "1", "-filter_complex_threads", "1", "-fflags", "+genpts"];
  const editing = ["video.edit", "audio.edit"].includes(mode);
  let duration = 0;
  if (editing) {
    const start = parseTime(options.start), end = parseTime(options.end);
    duration = end - start;
    if (duration <= 0) throw new Error("结束时间必须大于起点。");
    args.push("-ss", String(start));
  }
  if (mode === "video.gif") {
    const start = Number(options.start ?? 0), duration2 = Number(options.duration ?? 5);
    if (!Number.isFinite(start) || start < 0 || start > 86400 || !Number.isFinite(duration2) || duration2 <= 0 || duration2 > 60 || !Number.isInteger(fps) || fps < 1 || fps > 30) throw new Error("GIF 片段须为 0～24 小时内的起点、1～60 秒时长，帧率须为 1～30。");
    const colors = { high: 256, balanced: 128, small: 64 }[quality], dither = quality === "small" ? "bayer:bayer_scale=3" : "sierra2_4a";
    args.push("-ss", String(start), "-i", input, "-t", String(duration2), "-an", "-filter_complex", `fps=${fps},${scale},split[a][b];[a]palettegen=max_colors=${colors}:stats_mode=single[p];[b][p]paletteuse=new=1:dither=${dither}`, "-loop", "0", output);
  } else if (["video.audio", "audio.compress", "audio.convert", "audio.speed", "audio.edit"].includes(mode)) {
    const codec = audioFormats[options.format]?.[0];
    if (!codec) throw new Error("音频格式无效。");
    const advanced = mode !== "video.audio", sampleRate = Number(options.sampleRate ?? 0), channels = Number(options.channels ?? 0), selectedBitrate = Number(options.bitrate ?? 0);
    if (advanced && (![0, 8e3, 16e3, 22050, 24e3, 32e3, 44100, 48e3].includes(sampleRate) || ![0, 1, 2].includes(channels) || ![0, 32, 48, 64, 96, 128, 160, 192, 256, 320].includes(selectedBitrate))) throw new Error("音频采样率、声道或码率无效。");
    if (mode === "audio.compress" && ["wav", "flac"].includes(options.format)) throw new Error("音频压缩请选择 MP3、M4A、OGG 或 Opus。");
    if (advanced && options.format === "opus" && ![0, 8e3, 16e3, 24e3, 48e3].includes(sampleRate)) throw new Error("Opus 采样率请选择 8、16、24 或 48 kHz。");
    args.push("-i", input, "-map", "0:a:0", "-vn", "-c:a", codec);
    if (editing) {
      const fadeIn = Number(options.fadeIn ?? 0), fadeOut = Number(options.fadeOut ?? 0);
      if (!Number.isFinite(fadeIn) || !Number.isFinite(fadeOut) || fadeIn < 0 || fadeOut < 0 || fadeIn + fadeOut > duration) throw new Error("淡入淡出时间不能超过片段长度。");
      args.push("-t", String(duration));
      const filters = [`atrim=end=${duration}`];
      if (fadeIn) filters.push(`afade=t=in:st=0:d=${fadeIn}`);
      if (fadeOut) filters.push(`afade=t=out:st=${duration - fadeOut}:d=${fadeOut}`);
      args.push("-af", filters.join(","));
    }
    if (mode === "audio.speed") args.push("-af", speedFilter(options.speed, options.keepPitch !== false));
    if (advanced) {
      if (options.format === "ogg") args.push("-q:a", String({ high: 5, balanced: 3, small: mode === "audio.compress" ? 0 : 1 }[quality]));
      else if (!["wav", "flac"].includes(options.format)) {
        let kbps = selectedBitrate || { high: 192, balanced: 128, small: mode === "audio.compress" ? 64 : 96 }[quality];
        if (options.format === "mp3" && sampleRate && sampleRate < 32e3) kbps = Math.min(kbps, 160);
        args.push("-b:a", kbps + "k");
      }
      if (channels) args.push("-ac", String(channels));
      if (sampleRate || options.format === "opus") args.push("-ar", String(sampleRate || 48e3));
      if (options.format === "flac") args.push("-compression_level", "8");
    } else {
      if (!["wav", "flac"].includes(options.format)) args.push("-b:a", bitrate);
      if (options.format === "opus") args.push("-ar", "48000");
    }
    args.push(output);
  } else {
    if (!["video.compress", "video.convert", "gif.video", "video.speed", "video.edit"].includes(mode) || !videoFormats[options.format]) throw new Error("视频格式无效。");
    if (mode === "gif.video") args.push("-ignore_loop", "1");
    const filters = editing ? [`trim=end=${duration}`] : [];
    if (mode === "video.edit") {
      const x = Number(options.x ?? 0), y = Number(options.y ?? 0), w = Number(options.width ?? 0), h = Number(options.height ?? 0);
      if ([x, y, w, h].some((v) => !Number.isInteger(v) || v < 0) || Boolean(w) !== Boolean(h)) throw new Error("裁剪坐标须为非负整数；宽高同时为零表示整图。");
      if (w && h) {
        if (w < 2 || h < 2) throw new Error("视频裁剪宽高至少 2 像素。");
        filters.push(`crop=${w}:${h}:${x}:${y}`);
      }
      const rotation = Number(options.rotation ?? 0);
      if (![0, 90, 180, 270].includes(rotation)) throw new Error("旋转角度无效。");
      if (rotation === 90) filters.push("transpose=1");
      if (rotation === 180) filters.push("hflip", "vflip");
      if (rotation === 270) filters.push("transpose=2");
      if (options.mirror) filters.push("hflip");
    }
    filters.push(mode === "video.speed" ? `${scale},setpts=(PTS-STARTPTS)/${Number(options.speed)}` : scale);
    args.push("-i", input, "-map", "0:v:0", "-map", "0:a:0?", "-vf", filters.join(","), "-pix_fmt", "yuv420p", "-c:v", videoFormats[options.format][0]);
    if (editing) args.push("-t", String(duration), "-af", `atrim=end=${duration}`, "-fps_mode", "vfr", "-shortest");
    if (mode === "video.speed") args.push("-af", speedFilter(options.speed, options.keepPitch !== false));
    if (options.format === "webm") args.push("-crf", String(Math.min(63, crf + 5)), "-b:v", "1M", "-deadline", "good", "-cpu-used", "4", "-lag-in-frames", "0", "-auto-alt-ref", "0");
    else if (options.format === "avi") args.push("-q:v", String({ high: 3, balanced: 6, small: 10 }[quality]));
    else args.push("-crf", String(crf), "-preset", "veryfast");
    args.push("-threads", "1", "-c:a", videoFormats[options.format][1], "-b:a", bitrate);
    if (mode === "gif.video" || ["video.speed", "video.edit"].includes(mode) && options.mute === true) args.push("-an");
    if (["mp4", "mov"].includes(options.format)) args.push("-movflags", "+faststart");
    args.push(output);
  }
  return args;
}

// src-tauri/builtin-tools/src/media-edit.js
function mount({ files, resources, tasks, signal }) {
  const mode = $("edit-tool").dataset.mode, audio = mode === "audio.edit";
  let file = null, info = null, result = null, preview = null, busy = false, controller, disposed = false;
  $("video-settings").hidden = audio;
  $("audio-settings").hidden = !audio;
  $("video-preview").hidden = audio;
  $("audio-preview").hidden = !audio;
  const formats = audio ? audioFormats : videoFormats;
  for (const value of Object.keys(formats)) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = value.toUpperCase();
    $("format").append(option);
  }
  const update = () => {
    for (const el of document.querySelectorAll("input,select,button")) el.disabled = busy;
    $("process").disabled = busy || !file;
    $("save").disabled = busy || !result;
    $("cancel").disabled = false;
    $("cancel").hidden = !busy;
  };
  async function clear() {
    const old = result, reader = preview;
    result = preview = null;
    for (const id of ["video-preview", "audio-preview"]) {
      const player = $(id);
      player.pause();
      player.removeAttribute("src");
      player.load();
    }
    $("result").hidden = true;
    await reader?.close();
    await old?.abort();
  }
  async function job(work) {
    if (busy || disposed) return;
    busy = true;
    controller = new AbortController();
    const abort = () => controller?.abort();
    signal.addEventListener("abort", abort, { once: true });
    update();
    try {
      await work(controller.signal);
    } catch (error) {
      status(error.name === "AbortError" ? "已取消，可重新剪辑。" : error.message, true);
    } finally {
      signal.removeEventListener("abort", abort);
      controller = null;
      busy = false;
      if (!disposed) update();
    }
  }
  $("choose").onclick = () => void job(async (current) => {
    let next = await files.open({ extensions: [], signal: current });
    if (!next) return;
    next = await seekableFile(next, files, current);
    try {
      status("正在读取媒体信息…");
      const meta = await tasks.run("读取剪辑信息", (context) => mediaTask(context, resources, next, "media.info"), { signal: current, timeoutMs: 6e4 });
      await file?.close();
      file = next;
      info = meta.info;
      await clear();
      const duration = Number(info.format?.duration ?? 0);
      $("end").value = Number.isFinite(duration) && duration > 0 ? duration.toFixed(3) : "5";
      $("source-info").textContent = `${file.name} · ${size(file.size)} · 时长 ${duration || "未提供"} 秒`;
      status("设置片段起止时间后剪辑。");
    } catch (error) {
      await next.close();
      throw error;
    }
  });
  for (const el of document.querySelectorAll("input,select")) el.oninput = () => {
    void clear();
    update();
  };
  $("process").onclick = () => void job(async (current) => {
    const options = { format: $("format").value, quality: $("quality").value, resolution: 0, start: $("start").value, end: $("end").value, fadeIn: $("fade-in").value, fadeOut: $("fade-out").value, x: $("x").value, y: $("y").value, width: $("width").value, height: $("height").value, rotation: $("rotation").value, mirror: $("mirror").checked, mute: $("mute").checked };
    plan(mode, options);
    const duration = Number(info?.format?.duration), selectedDuration = parseTime(options.end) - parseTime(options.start);
    if (Number.isFinite(duration) && duration > 0 && parseTime(options.end) > duration + 0.05) throw new Error("结束时间超出媒体时长。");
    const video = info?.streams?.find((stream) => stream.codec_type === "video");
    if (!audio && Number(options.width) && video && (Number(options.x) + Number(options.width) > video.width || Number(options.y) + Number(options.height) > video.height)) throw new Error("裁剪区域超出原视频尺寸。");
    await clear();
    const writer = await files.createWriter(outputName(file.name, "-edited", options.format));
    try {
      const completed = await tasks.run(audio ? "音频剪辑" : "视频剪辑", (context) => {
        status("正在剪辑并编码…");
        return mediaTask(context, resources, file, mode, options, writer);
      }, { signal: current, timeoutMs: 18e5 });
      preview = await writer.preview({ signal: current });
      result = writer;
      $("result").hidden = false;
      const actual = Number(completed.duration), known = Number.isFinite(actual) && actual > 0;
      $("result-info").textContent = `${known ? "实际时长 " + actual.toFixed(3) : "所选区间 " + selectedDuration} 秒 · ${size(preview.size)}`;
      const supported = ["mp4", "webm", "mp3", "m4a", "wav", "flac", "ogg", "opus"].includes(options.format);
      if (supported) {
        const player = $(audio ? "audio-preview" : "video-preview");
        player.src = preview.url;
        player.load();
      }
      status(known && actual < selectedDuration - 0.15 ? "剪辑完成。输出短于所选区间，可能是原文件画面或音轨提前结束；可保存后检查。" : supported ? "剪辑完成，可预览并保存。" : "剪辑完成，请保存后使用支持该格式的播放器查看。");
    } catch (error) {
      if (result === writer) await clear();
      else await writer.abort();
      throw error;
    }
  });
  $("save").onclick = () => void job(async (current) => {
    if (result && await result.save({ signal: current })) {
      result = null;
      status("文件已保存。");
    } else status("已取消保存。");
  });
  $("cancel").onclick = () => controller?.abort();
  update();
  return () => {
    disposed = true;
    controller?.abort();
    void file?.close();
    void clear();
  };
}
export {
  mount
};

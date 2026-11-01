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

// src-tauri/builtin-tools/src/media.js
function mount({ files, resources, tasks, signal }) {
  const mode = $("media-tool").dataset.mode;
  let input = null, output = null, preview = null, controller = null, busy = false, disposed = false, previewUrl = "";
  const audio = mode === "video.audio" || mode.startsWith("audio."), advancedAudio = mode.startsWith("audio."), gif = mode === "video.gif", fromGif = mode === "gif.video";
  const formats = gif ? { gif: [] } : mode === "audio.compress" ? { mp3: [], m4a: [], ogg: [], opus: [] } : audio ? audioFormats : fromGif ? { mp4: [], webm: [] } : videoFormats;
  $("format").replaceChildren(...Object.keys(formats).map((value) => {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = value.toUpperCase();
    return option;
  }));
  $("resolution-field").hidden = audio;
  $("gif-settings").hidden = !gif;
  $("audio-settings").hidden = !advancedAudio;
  $("speed-settings").hidden = !mode.endsWith(".speed");
  $("mute-field").hidden = mode !== "video.speed";
  if (mode === "video.speed") $("resolution").value = "0";
  if (mode === "audio.compress") $("quality").value = "small";
  if (gif) $("resolution").value = "360";
  $("source-info").textContent = fromGif ? "选择 GIF 动图，保留单次动画的帧时间。" : advancedAudio ? "支持 MP3、M4A、AAC、WAV、FLAC、OGG、Opus、WMA、AIFF 等音频。单个文件最多 2 GiB。" : "支持 MP4、MOV、WebM、MKV、AVI 等常见视频。单个文件最多 2 GiB。";
  if (advancedAudio) $("usage-hint").textContent = "降低码率、采样率或改为单声道可缩小音频。有损格式再次压缩会损失音质；WAV / FLAC 不使用码率档位，OGG 按音质使用可变码率。Opus 支持 8 / 16 / 24 / 48 kHz，低采样率 MP3 最高 160 kbps。文件读写上限 2 GiB。";
  const update = () => {
    const format = $("format").value, lossless = ["wav", "flac"].includes(format);
    for (const el of document.querySelectorAll("input,select,#choose")) el.disabled = busy;
    if (audio && (lossless || advancedAudio && format !== "ogg" && Number($("bitrate").value) > 0)) $("quality").disabled = true;
    $("bitrate").disabled = busy || lossless || format === "ogg";
    for (const option of $("sample-rate").options) option.disabled = format === "opus" && ![0, 8e3, 16e3, 24e3, 48e3].includes(Number(option.value));
    if (format === "opus" && ![0, 8e3, 16e3, 24e3, 48e3].includes(Number($("sample-rate").value))) $("sample-rate").value = "48000";
    $("process").disabled = busy || !input;
    $("save").disabled = busy || !output;
    $("cancel").hidden = !busy;
  };
  async function clearResult() {
    const old = output, reader = preview;
    output = preview = null;
    $("result").hidden = true;
    for (const el of [$("preview"), $("preview-audio")]) {
      el.pause();
      el.removeAttribute("src");
      el.load();
    }
    $("preview-image").removeAttribute("src");
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = "";
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
      status(error.name === "AbortError" ? "已取消，可重新处理。" : error.message, true);
    } finally {
      signal.removeEventListener("abort", abort);
      busy = false;
      controller = null;
      if (!disposed) update();
    }
  }
  $("choose").onclick = () => void job(async (current) => {
    const next = await files.open({ extensions: fromGif ? ["gif"] : advancedAudio ? ["mp3", "m4a", "aac", "wav", "flac", "ogg", "opus", "wma", "aiff", "aif", "amr", "webm"] : ["mp4", "mov", "webm", "mkv", "avi", "m4v", "mpg", "mpeg", "flv", "wmv", "ts", "3gp"], signal: current });
    if (!next) {
      status("已取消选择。");
      return;
    }
    if (!next.seekable || !next.url) {
      const scratch = await files.createWriter(next.name.slice(0, 120));
      try {
        status("正在准备文件…");
        await scratch.write(next.stream({ signal: current }), { signal: current });
        const reader = await scratch.preview({ signal: current });
        await scratch.abort();
        await next.close();
        await input?.close();
        input = reader;
      } catch (error) {
        await scratch.abort();
        await next.close();
        throw error;
      }
    } else {
      await input?.close();
      input = next;
    }
    await clearResult();
    $("source-info").textContent = `${input.name} · ${size(input.size)}`;
    status("文件已选择，设置参数后开始转换。");
  });
  for (const el of document.querySelectorAll("input,select")) el.oninput = () => {
    void clearResult();
    update();
    status("参数已更新。");
  };
  $("process").onclick = () => void job(async (current) => {
    if (!input) return;
    const options = { format: $("format").value, quality: $("quality").value, resolution: $("resolution").value, fps: $("fps").value, start: $("start").value, duration: $("duration").value, bitrate: $("bitrate").value, sampleRate: $("sample-rate").value, channels: $("channels").value, speed: $("speed").value, keepPitch: $("keep-pitch").checked, mute: $("mute").checked };
    plan(mode, options);
    await clearResult();
    $("progress").value = 0;
    $("detail").textContent = "";
    const name = outputName(input.name, "-converted", options.format), writer = await files.createWriter(name);
    try {
      await tasks.run($("media-tool").getAttribute("aria-label"), async (context) => {
        status("正在加载离线转换引擎…");
        context.report(0.01);
        const coreUrl = await resources.url("engine/ffmpeg-core.js", { signal: context.signal }), wasm = await (await resources.blob("engine/ffmpeg-core.wasm", { signal: context.signal })).arrayBuffer();
        const worker = await context.worker("engine/media-worker.js");
        await workerRequest(
          worker,
          { coreUrl, wasm, mode, options, extension: input.name.match(/\.([a-z0-9]{1,10})$/i)?.[1].toLowerCase() ?? (fromGif ? "gif" : "mp4"), input: { url: input.url, size: input.size }, output: { url: writer.workspaceUrl, size: 0 } },
          { ...context, report: (value) => {
            context.report(value);
            $("progress").value = value;
            status(`正在转换… ${Math.round(value * 100)}%`);
          }, onLog: (message) => {
            $("detail").textContent = message.slice(0, 200);
          } },
          [wasm]
        );
      }, { signal: current, timeoutMs: 18e5 });
      preview = await writer.preview({ signal: current });
      output = writer;
      $("result").hidden = false;
      $("result-info").textContent = `${name} · ${size(input.size)} → ${size(preview.size)}`;
      $("preview").hidden = gif || audio;
      $("preview-audio").hidden = !audio;
      $("preview-image").hidden = !gif;
      if (gif) {
        if (preview.size <= 16 * 1048576) {
          previewUrl = URL.createObjectURL(await preview.blob({ maxBytes: 16 * 1048576, signal: current }));
          $("preview-image").src = previewUrl;
        } else {
          $("preview-image").hidden = true;
          $("detail").textContent = "GIF 大于 16 MiB，请保存后查看动图。";
        }
      } else if (["mp4", "webm", "mp3", "m4a", "wav", "flac", "ogg", "opus"].includes(options.format)) {
        const player = audio ? $("preview-audio") : $("preview");
        player.src = preview.url;
        player.load();
      } else $("detail").textContent = "该格式可保存后在支持它的播放器中打开。";
      $("progress").value = 1;
      status(["video.compress", "audio.compress"].includes(mode) && preview.size >= input.size ? "处理完成，输出比原文件大；可降低质量或调整压缩参数后重试。" : "处理完成，可以预览并保存。");
    } catch (error) {
      if (output === writer) await clearResult();
      else await writer.abort();
      throw error;
    }
  });
  $("save").onclick = () => void job(async (current) => {
    if (output && await output.save({ signal: current })) {
      output = null;
      status("文件已保存。");
    } else status("已取消保存，可以再次保存。");
  });
  $("cancel").onclick = () => controller?.abort();
  update();
  return () => {
    disposed = true;
    controller?.abort();
    void input?.close();
    void clearResult();
  };
}
export {
  mount
};

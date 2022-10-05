<script>
  import * as ebml from "./ts-ebml.min.js";
  import notifs from "./notifs.js";
  import ToastContainer from "./ToastContainer.svelte";
  import alterVid from "./canvasVid.js";
  import { onMount } from "svelte";
  import { createFFmpeg } from "@ffmpeg/ffmpeg/dist/ffmpeg.min.js";

  //Streams
  let videoStream,
    audioStream,
    combinedStream,
    tracks = [],
    paused = false,
    preview,
    chunks = [],
    done = false,
    output,
    error = false,
    mime,
    alteredVid,
    videoConstraints = {
      width: 1280,
      height: 720,
      frameRate: { ideal: 30 },
    },
    audioConstraints = {
      autoGainControl: false,
      echoCancellation: false,
      noiseSuppression: false,
    },
    converting = false,
    conversionOutput = "Starting conversion...",
    conversionScreen = false,
    conversionDone = false,
    worker,
    conversion_opts,
    outputExpected = {
      name: "output.gif",
      mimeType: "image/gif",
      extension: "gif",
    },
    conversionOutputFile,
    conversionSelect,
    workerLoaded = false,
    workerLoading = false,
    conversionProgress,
    videoStartWhen = "immediately";

  //MediaRecorder
  let recorder;
  //Selects
  let videoSelect = "screen",
    audioSelect = "system";
  let recording = false;
  $: {
    // This is bad JavaScript kids, don't try this at home
    document.title = error
      ? "Error!"
      : recording
      ? "Recording..."
      : converting
      ? "Converting"
      : done
      ? "Done!"
      : "Screen Recorder";
  }
  $: {
    let emoji = error
      ? "✋"
      : recording
      ? "⭕"
      : converting
      ? "📂"
      : done
      ? "✔️"
      : "🎥";
    document.querySelector("link[rel=icon]").href =
      "data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%22256%22 height=%22256%22 viewBox=%220 0 100 100%22><rect width=%22100%22 height=%22100%22 rx=%2220%22 fill=%22%23f4f4f4%22></rect><text x=%2250%%22 y=%2250%%22 dominant-baseline=%22central%22 text-anchor=%22middle%22 font-size=%2270%22>" +
      emoji +
      "</text></svg>";
  }
  const MIME_TYPES = {
    "video/webm;codecs=opus": "webm",
    "video/webm;codecs=vp8": "webm",
    "video/webm;codecs=daala": "webm",
    "video/webm;codecs=h264": "webm",
    "video/mpeg": "mpg",
    "video/x-matroska;codecs=avc1,opus": "mkv",
    "video/x-flv": "flv",
    "video/mp4": "mp4",
    "video/3gpp": "3gpp",
    "video/quicktime": "mov",
    "video/x-msvideo": "avi",
    "video/x-ms-wmv": "wmv",
  };
  const CONVERSIONS = [
    {
      label: "Convert to GIF",
      command: "-i [INPUT] -vf showinfo -strict -2 output.gif",
      expected: { mimeType: "image/gif", name: "output.gif", extension: "gif" },
    },
    {
      label: "Convert to high quality GIF",
      command: `-y -i [INPUT] -filter_complex "fps=24,scale=1280:-1:flags=lanczos[x];[x]split[x1][x2]; [x1]palettegen[p];[x2][p]paletteuse" output.gif`,
      expected: {
        mimeType: "image/gif",
        name: "output.gif",
        extension: "gif",
      },
    },
    {
      label: "Remove the last few seconds of the video",
      command: `-sseof -[PROMPT=How many seconds would you like to remove?] -i [INPUT] -c copy [OUTPUT=mp4]`,
      expected: {
        mimeType: "video/mp4",
        name: "output.mp4",
        extension: "mp4",
      },
    },
    {
      label: "Convert to sped up GIF",
      // 0.3 -> 3x
      command: `-an -itsscale [PROMPT=What speed? (0.3 = 3x sped up, 0.5 = 2x sped up, 1 = 1x, 2 = 0.5x slowed)] -i [INPUT] -vf "fps=30,scale=1280:-1:flags=lanczos,split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse" -loop 0 output.gif`,
      expected: {
        mimeType: "image/gif",
        name: "output.gif",
        extension: "gif",
      },
    },
    {
      label: "Convert to MP4",
      command: `-loglevel debug -i [INPUT] -c copy -strict experimental output.mp4`,
      expected: {
        mimeType: "video/mp4",
        name: "output.mp4",
        extension: "mp4",
      },
    },
    {
      label: "Custom FFMPEG Command",
      // This syntax is janky, I know
      command:
        "[PROMPT=What command would you like to run? (Use '!$%INPUT%$!' for the input file and '!$%OUTPUT=extension%$!') for output files.]",
    },
  ];
  onMount(() => {
    videoConstraints.width = screen.width;
    videoConstraints.height = screen.height;
    const CUSTOM_LABELS = {};
    Object.defineProperty(MediaStreamTrack.prototype, "lbl", {
      get() {
        return CUSTOM_LABELS[this.id] || this.label;
      },
      set(label) {
        CUSTOM_LABELS[this.id] = label;
        return label;
      },
    });
  });

  async function startRecording() {
    error = false;
    done = false;
    output = null;
    let screen = {
      video: false,
      audio: false,
    };
    let external = {
      video: false,
      audio: false,
    };
    if (videoSelect === "mix") {
      external.video = true;
      screen.video = true;
    }
    if (videoSelect === "screen") {
      screen.video = true;
    }
    if (videoSelect === "camera") {
      external.video = true;
    }
    if (audioSelect === "system") {
      screen.audio = true;
    }
    if (audioSelect === "microphone") {
      external.audio = true;
    }
    if (audioSelect === "none") {
      externalAudio = false;
      screenAudio = false;
    }
    if (audioSelect === "both") {
      external.audio = true;
      screen.audio = true;
    }
    let audioStreams = [];
    let videoStreams = [];

    if (external.audio || external.video) {
      console.log("Getting from external", external);
      let _stream = await navigator.mediaDevices.getUserMedia(
        getConstraints(external)
      );
      tracks = [...tracks, ..._stream.getTracks()];
      _stream.getTracks().forEach((track) => {
        track.lbl = `External ${
          track.kind === "audio" ? "microphone" : "camera"
        }`;
      });
      console.log("Got stream");
      if (external.audio) {
        audioStreams.push(_stream);
      }
      if (external.video) {
        videoStreams.push(_stream);
      }
      notifs.show(
        `Got ${
          external.audio && external.video
            ? "video and audio"
            : external.audio
            ? "audio"
            : "video"
        } stream from external device`
      );
    }
    if (screen.audio || screen.video) {
      console.log("Getting from screen", screen);
      let _stream = await navigator.mediaDevices.getDisplayMedia(
        getConstraints(screen)
      );
      tracks = [...tracks, ..._stream.getTracks()];
      _stream.getTracks().forEach((track) => {
        track.lbl = `System ${track.kind === "audio" ? "audio" : "screen"}`;
      });
      console.log("Got stream");
      if (screen.audio) {
        audioStreams.push(_stream);
      }
      if (screen.video) {
        videoStreams.push(_stream);
      }
      notifs.show(
        `Got ${
          screen.audio && screen.video
            ? "video and audio"
            : screen.audio
            ? "audio"
            : "video"
        } stream from screen share`
      );
    }

    if (audioSelect === "both") {
      if (audioStreams.length !== 2) {
        throw new Error(
          "Expected both system and microphone audio tracks to merge"
        );
      }
      let merged = mergeStreams(audioStreams[0], audioStreams[1]);
      console.log(merged);
      audioStream = new MediaStream(merged);
      audioStream.getTracks().forEach((track) => {
        track.lbl = `${track.kind[0].toUpperCase()}${track.kind.slice(
          1
        )} merged audio stream`;
      });
      notifs.show("Merged system and microphone audio");
    } else if (audioSelect !== "none") {
      if (audioStreams.length !== 1) {
        console.debug({ audioStreams });
        throw new Error(
          "Expected 1 audio track but found " + audioStreams.length
        );
      }
      audioStream = new MediaStream(audioStreams[0]);
    }
    if (videoSelect === "mix") {
      if (videoStreams.length !== 2) {
        throw new Error(
          "Expected both webcam and screen video tracks to merge"
        );
      }
      // TODO: Make alterVid merge both
      let merged = await alterVid({
        track: videoStreams[0].getVideoTracks()[0],
        maxWidth: videoConstraints.width || 1280,
      });
      console.log(merged);
      alteredVid = merged;
      videoStream = new MediaStream(merged.stream);
      videoStream.getTracks().forEach((track) => {
        track.lbl = `${track.kind[0].toUpperCase()}${track.kind.slice(
          1
        )} from merged video stream`;
      });
      notifs.show("Merged webcam and system video");
    } else {
      if (videoStreams.length !== 1) {
        console.debug({ videoStreams });
        throw new Error(
          "Expected 1 video track but found " + videoStreams.length
        );
      }
      videoStream = new MediaStream(videoStreams[0]);
    }

    combinedStream = new MediaStream([
      ...videoStream.getTracks(),
      ...(audioSelect === "none" ? [] : audioStream.getTracks()),
    ]);

    tracks.forEach((track) => {
      track.onended = () => {
        console.log("Track ended: ", track);
        stopRecording();
      };
    });
    if (!mime) {
      throw new Error("No supported mimeType found");
    }
    recorder = new MediaRecorder(combinedStream, {
      mimeType: mime,
    });
    Object.assign(window, {
      recorder,
      conversionSelect,
      videoStream,
      audioStream,
      combinedStream,
      tracks,
      stopRecording,
      stopTrack,
      startRecording,
      paused,
      recording,
      fixBlob,
      done,
      chunks,
      output,
      error,
      mime,
      alteredVid,
      videoConstraints,
      audioConstraints,
      converting,
      conversionOutput,
      conversionScreen,
      worker,
      conversion_opts,
      videoSelect,
      audioSelect,
      addFilesToConversion,
      getConstraints,
      alterVid,
    });

    switch (videoStartWhen) {
      case "immediately":
        recorder.start();
        break;
      case "delay":
        notifs.show("Starting recording in 5 seconds", { timeout: 4000 });
        setTimeout(() => recorder.start(), 5000);
        break;
      case "blur":
        notifs.show("Ready to start recording when you leave this page");
        const handle = () => {
          recorder.start();
          window.removeEventListener("blur", handle);
        };
        window.addEventListener("blur", handle);
        break;
      default:
        console.error("Method not found: ", videoStartWhen);
        recorder.start();
        break;
    }

    recorder.onstart = () => {
      console.log("Started recording");
    };
    recorder.ondataavailable = (e) => {
      chunks.push(e.data);
    };
    recorder.onpause = () => {
      paused = true;
    };
    recorder.onresume = () => {
      paused = false;
    };
    preview.srcObject = combinedStream;
    // Set variables at the end in case of error
    paused = false;
    recording = true;
  }
  function stopRecording() {
    tracks.forEach((track) => track.stop());
    if (!recorder) {
      return console.log("Couldn't find recorder, probably some other error");
    }
    recorder.onstop = async () => {
      if (alteredVid) {
        alteredVid.stop();
      }
      notifs.show("Stopped recording");
      console.log(recorder.mimeType, mime);
      let blob = new Blob(chunks, { type: mime });
      if (mime.startsWith("video/webm")) {
        notifs.show("Making video seekable...");
        let making_seekable = true;
        // TODO: FixBlob can take a bit, give indication to user
        fixBlob(blob)
          .then((b) => {
            output = b;
            done = true;
            making_seekable = false;
            notifs.show("Made video seekable!");
          })
          .catch((e) => {
            console.error(e);
            err();
          });
        setTimeout(() => {
          if (making_seekable) {
            err();
          }
        }, 5000);
        function err() {
          done = true;
          output = blob;
          notifs.show(
            "Error making video seekable, reverting to non-seekable version",
            { timeout: 5000 }
          );
        }
      } else {
        output = blob;
        done = true;
      }
    };
    recorder.addEventListener("dataavailable", () => {
      //requestData needs to have state: recording
      try {
        recorder.stop();
      } catch (e) {}
    });
    try {
      recorder.requestData();
    } catch (e) {}
    paused = false;
    recording = false;
  }
  function mergeStreams(stream1, stream2) {
    const ctx = new AudioContext();
    const source1 = ctx.createMediaStreamSource(stream1);
    const source2 = ctx.createMediaStreamSource(stream2);
    const destination = ctx.createMediaStreamDestination();

    const s1_gain = ctx.createGain();
    const s2_gain = ctx.createGain();

    s1_gain.gain.value = 0.7;
    s2_gain.gain.value = 0.7;

    source1.connect(s1_gain).connect(destination);
    source2.connect(s2_gain).connect(destination);

    return destination.stream.getTracks();
  }
  function stopTrack(track) {
    if (!tracks.includes(track)) {
      throw new Error("Couldn't find track in list");
    }
    tracks = tracks.filter((i) => i !== track);
    combinedStream.removeTrack(track);
  }
  function loadWorker() {
    if (workerLoaded || workerLoading) {
      return;
    }
    workerLoading = true;
    workerLoaded = false;
    let ffmpeg = createFFmpeg({
      log: true,
    });
    window.ffmpeg = ffmpeg;
    if (ffmpeg.isLoaded()) {
      workerLoaded = true;
      workerLoading = false;
      return;
    }
    notifs.show("Loading ffmpeg...");
    ffmpeg.load().then(() => {
      notifs.show("FFmpeg loaded");
      workerLoaded = true;
      workerLoading = false;
      console.log("FFmpeg loaded", ffmpeg);
    });
  }
  async function fixBlob(blob) {
    const { Decoder, tools, Reader } = ebml;
    const decoder = new Decoder();
    const reader = new Reader();
    reader.logging = true;
    reader.logGroup = "Fixing file";
    reader.drop_default_duration = false;
    const buffer = await readAsArrayBuffer(blob);
    const elms = decoder.decode(buffer);
    elms.forEach((elm) => {
      reader.read(elm);
    });
    reader.stop();
    const metadata = tools.makeMetadataSeekable(
      reader.metadatas,
      reader.duration,
      reader.cues
    );
    const body = buffer.slice(reader.metadataSize);
    const fixed = new Blob([metadata, body], {
      type: "video/webm",
    });
    return fixed;
  }
  function getConstraints(a) {
    let out = {};
    if (a.video === true) {
      out.video = {
        width: 1280,
        height: 720,
        frameRate: { ideal: 30 },
        ...videoConstraints,
      };
      out.video.width = parseInt(out.video.width, 10);
      out.video.height = parseInt(out.video.height, 10);
      out.video.frameRate.ideal = parseInt(out.video.frameRate.ideal, 10);
    }
    if (a.audio === true) {
      out.audio = {
        autoGainControl: false,
        echoCancellation: false,
        noiseSuppression: false,
        ...audioConstraints,
      };
      out.audio.autoGainControl = !!out.audio.autoGainControl;
      out.audio.echoCancellation = !!out.audio.echoCancellation;
      out.audio.noiseSuppression = !!out.audio.noiseSuppression;
      out.audio.autoGainControl = !!out.audio.autoGainControl;
    }
    return out;
  }
  function saveBlob(blob, fileName) {
    var a = document.createElement("a");
    document.body.appendChild(a);
    a.style = "display: none";

    var url = window.URL.createObjectURL(blob);
    a.href = url;
    a.download = fileName;
    a.click();
    window.URL.revokeObjectURL(url);
  }
  function parseArguments(text) {
    text = text.replace(/\s+/g, " ");
    var args = [];
    // Allow double quotes to not split args.
    text.split('"').forEach(function (t, i) {
      t = t.trim();
      if (i % 2 === 1) {
        args.push(t);
      } else {
        args = args.concat(t.split(" "));
      }
    });
    return args;
  }
  function readAsArrayBuffer(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsArrayBuffer(blob);
      reader.onloadend = () => {
        resolve(reader.result);
      };
      reader.onerror = (ev) => {
        reject(ev.error);
      };
    });
  }
  async function record() {
    try {
      await startRecording();
    } catch (e) {
      console.error(e);
      error = e.message;
      stopRecording();
    }
  }
  function getExtension(type) {
    return MIME_TYPES[type] || type.split("/")[1];
  }
  async function addFilesToConversion() {
    loadWorker();
    try {
      console.log(output);
      conversion_opts = {
        files: [
          {
            name: "input." + getExtension(output.type),
            data: new Uint8Array(await readAsArrayBuffer(output)),
          },
        ],
      };
      conversionScreen = true;
      done = false;
      console.log("Added files, ready for conversion now: ", conversion_opts);
    } catch (e) {
      console.error(e);
      error = e;
    }
  }
  function replaceCommand(command, selected) {
    command = command
      .replace(/\[OUTPUT=([^\]]+)\]/, (_, expected) => {
        outputExpected = {
          extension: expected,
          name: `output.${expected}`,
          // TODO: Better mimeType handling
          mimeType:
            (["gif", "png", "jpeg", "tiff"].includes(expected)
              ? "image"
              : "video") +
            "/" +
            expected,
        };
        selected.expected = outputExpected;
        return `output.${expected}`;
      })
      .replace("[INPUT]", "input." + getExtension(output.type))
      .replace(/\[PROMPT=([^\]]+)\]/, (_, p) =>
        replaceCommand(
          prompt(p.replaceAll("!$%", "[").replaceAll("%$!", "]")),
          selected
        )
      );
    if (!selected.expected) {
      error = "No output file found";
    }
    selected.expected = outputExpected;
    return command;
  }
</script>

<svelte:head>
  <meta lang="en" />
  <link rel="manifest" href="manifest.json" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="format-detection" content="telephone=no" />
  <meta name="title" content="Screen recorder" />
  <meta name="author" content="Explosion-Scratch" />
  <meta name="keywords" content="Screen record,webm,convert,open source" />
  <meta name="robots" content="index,follow" />
  <meta name="language" content="English" />
  <meta
    name="description"
    content="Screen record and convert from your web browser!"
  />
  <meta name="theme-color" content="#656C72" />
  <meta name="og:type" content="website" />
  <meta name="apple-mobile-web-app-title" content="Screen recorder" />
  <meta name="og_site_name" content="Screen recorder" />
  <meta name="og:site_name" content="Screen recorder" />
  <meta name="og:locale" content="en_US" />
  <meta
    name="og:url"
    content="https://explosion-scratch.github.io/screen-recorder"
  />
  <meta name="og:title" content="Screen recorder" />
  <meta
    name="og:description"
    content="Screen record and convert from your web browser!"
  />
  <meta
    name="og:image"
    content="https://explosion-scratch.github.io/screen-recorder/banner.png"
  />
  <meta name="twitter:card" content="summary_large_image" />
  <meta
    name="twitter:url"
    content="https://explosion-scratch.github.io/screen-recorder"
  />
  <meta name="twitter:title" content="Screen recorder" />
  <meta
    name="twitter:description"
    content="Screen record and convert from your web browser!"
  />
  <meta
    name="twitter:image"
    content="https://explosion-scratch.github.io/screen-recorder/banner.png"
  />
  <script src="coi-serviceworker.min.js"></script>
</svelte:head>

<!-- BEGIN_HTML -->
<ToastContainer />
<div class="outer">
  <div
    class="container"
    class:done
    class:error
    class:conversion={conversionScreen}
  >
    {#if error}
      <span
        >There was an error: {typeof error === "string"
          ? error
          : "<unknown>"}</span
      >
      <div class="buttons">
        <button aria-label="Reload" on:click={() => location.reload()}
          >Reload page</button
        >
        {#if output}
          <button
            aria-label="Reload page"
            on:click={() =>
              saveBlob(output, "Screen Recording." + getExtension(output.type))}
            >Download screen recording</button
          >
        {/if}
        {#if conversionOutputFile}
          <button
            aria-label="Download converted file"
            on:click={() => saveBlob(output, outputExpected.name)}
            >Download converted file</button
          >
        {/if}
      </div>
    {:else if done}
      <h2>Done!</h2>
      <video
        on:load={(e) => e.target.play()}
        autoplay
        playsinline
        muted
        controls
        src={URL.createObjectURL(output)}
      />
      <div class="buttons">
        <button
          aria-label="Download screen recording"
          on:click={() =>
            saveBlob(output, "Screen Recording." + getExtension(output.type))}
          >Download</button
        >
        <!-- TODO: Don't reload for re-record -->
        <button aria-label="Re-record" on:click={() => location.reload()}
          >Re-record</button
        >
        <button aria-label="Convert" on:click={() => addFilesToConversion()}
          >Convert</button
        >
      </div>
    {:else if conversionScreen}
      <div class="buttons">
        <h2>Convert video file</h2>
        {#if !conversionDone && !converting}
          <select bind:value={conversionSelect}>
            {#each CONVERSIONS as conversion, i}
              <option value="opt_{i}">{conversion.label}</option>
            {/each}
          </select>
        {/if}
        {#if !conversionDone}
          <div class="buttons">
            <button
              aria-label="Start converting"
              on:click={async (e) => {
                // Remove all files
                window.ffmpeg.FS("readdir", ".").forEach((i) => {
                  if (![".", "..", "tmp", "home", "dev", "proc"].includes(i)) {
                    window.ffmpeg.FS("unlink", i);
                  }
                });
                let selected =
                  CONVERSIONS[conversionSelect.replace("opt_", "")];
                outputExpected = selected.expected;
                if (e.target.disabled) {
                  return;
                }
                await addFilesToConversion();
                // conversion_opts should have an array of {}.files[{name, data: Uint8Array}]
                let msg = {
                  type: "command",
                  arguments: parseArguments(
                    replaceCommand(selected.command, selected)
                  ),
                  ...conversion_opts,
                };
                console.log(msg);
                converting = true;
                conversionDone = false;
                window.ffmpeg.setProgress(({ ratio }) => {
                  if (ratio <= 0.00000001) {
                    return (conversionProgress = null);
                  }
                  conversionProgress = `${(ratio * 100).toFixed(3)}%`;
                });
                window.ffmpeg.setLogger(({ message }) => {
                  conversionOutput = `${conversionOutput.trim()}\n${message}\n\n`;
                  requestAnimationFrame(() =>
                    document
                      .querySelector("pre.conversion_output")
                      .scrollBy(0, 1000)
                  );
                });
                conversionOutput = "Uploading files to WebAssembly worker...";
                for (let file of msg.files) {
                  window.ffmpeg.FS("writeFile", file.name, file.data);
                }
                try {
                  await window.ffmpeg.run(...msg.arguments);
                } catch (e) {
                  error = e.message;
                }
                for (let file of msg.files) {
                  await window.ffmpeg.FS("unlink", file.name, file.data);
                }
                conversionDone = true;
                converting = false;
                console.log("Getting output: ", outputExpected);
                if (!outputExpected.name) {
                  try {
                    outputExpected.name = window.ffmpeg
                      .FS("readdir", ".")
                      .find(
                        (i) =>
                          ![".", "..", "tmp", "home", "dev", "proc"].includes(i)
                      );
                    outputExpected.mimeType = CONVERSIONS.find(
                      (i) =>
                        i.expected.extension ===
                        outputExpected.name.split(".")[1]
                    ).mimeType;
                  } catch (e) {
                    console.log("Couldn't find output");
                    return;
                  }
                }
                if (
                  !window.ffmpeg
                    .FS("readdir", ".")
                    .includes(outputExpected?.name)
                ) {
                  notifs.show("Couldn't find output file");
                  conversionOutput += "\nError: Couldn't find output file";
                  return;
                }
                conversionOutputFile = new Blob(
                  [window.ffmpeg.FS("readFile", outputExpected.name).buffer],
                  {
                    type: outputExpected.mimeType,
                  }
                );
              }}
              disabled={converting || !workerLoaded}
            >
              {#if !workerLoaded}
                Loading converter...
              {:else if converting}
                Converting{#if conversionProgress}&nbsp;&nbsp;({conversionProgress}){:else}...{/if}
              {:else}
                Start converting
              {/if}
            </button>
          </div>
        {/if}
        {#if converting && !conversionDone}
          <pre class="conversion_output">{conversionOutput}</pre>
          {#if /error/i.test(conversionOutput)}
            <span
              >Seems like there was an error, try again or download original?</span
            >
            <div class="buttons">
              <button
                aria-label="Re-convert file"
                on:click={() => (
                  (conversionDone = false),
                  (converting = false),
                  (conversionOutput = ""),
                  (conversion_opts = ""),
                  (outputExpected = {}),
                  (conversionOutputFile = null)
                )}>Re-convert</button
              >
              <button
                aria-label="Download screen recording"
                on:click={() =>
                  saveBlob(
                    output,
                    "Screen Recording." + getExtension(output.type)
                  )}>Download screen recording</button
              >
            </div>
          {/if}
        {/if}
        {#if conversionDone}
          <details class="conversion_logs">
            <summary>Show logs</summary>
            <pre class="conversion_output">{conversionOutput}</pre>
          </details>
        {/if}
        {#if conversionDone}
          {#if outputExpected.mimeType.startsWith("video/")}
            <video
              on:load={(e) => e.target.play()}
              autoplay
              playsinline
              muted
              controls
              src={URL.createObjectURL(conversionOutputFile)}
            />
          {:else if outputExpected.mimeType.startsWith("image/")}
            <img
              src={URL.createObjectURL(conversionOutputFile)}
              alt="Conversion output"
            />
          {/if}
          <div class="buttons">
            <button
              aria-label="Download conversion output"
              on:click={() =>
                saveBlob(conversionOutputFile, outputExpected.name)}
              >Download</button
            >
            <button
              aria-label="Download screen recorded original"
              on:click={() =>
                saveBlob(
                  output,
                  "Screen Recording." + getExtension(output.type)
                )}>Download original</button
            >
            <button
              aria-label="Re-convert"
              on:click={() => (
                (conversionDone = false),
                (converting = false),
                (conversionOutput = ""),
                (conversion_opts = ""),
                (outputExpected = {}),
                (conversionOutputFile = null)
              )}>Re-convert</button
            >
          </div>
        {/if}
      </div>
    {:else}
      <div bind class="preview" style:display={recording ? "block" : "none"}>
        <video bind:this={preview} muted autoplay playsinline />
      </div>
      <div class="start_stop">
        {#if recording}
          <button
            aria-label="Pause and resume recording"
            class="pause_resume"
            on:click={() =>
              recorder.state === "paused"
                ? recorder.resume()
                : recorder.state === "recording" && recorder.pause()}
          >
            {#if paused}
              <svg width="32" height="32" viewBox="0 0 256 256"
                ><path
                  fill="currentColor"
                  d="M80 230a14.1 14.1 0 0 1-14-14V40a14 14 0 0 1 21.3-11.9l144 88a13.9 13.9 0 0 1 0 23.8l-144 88A14 14 0 0 1 80 230Zm0-192a1.5 1.5 0 0 0-1 .3a1.8 1.8 0 0 0-1 1.7v176a1.8 1.8 0 0 0 1 1.7a2 2 0 0 0 2 0l144-88a1.9 1.9 0 0 0 0-3.4l-144-88a1.9 1.9 0 0 0-1-.3Z"
                /></svg
              >
            {:else}
              <svg width="32" height="32" viewBox="0 0 256 256"
                ><path
                  fill="currentColor"
                  d="M200 34h-36a14 14 0 0 0-14 14v160a14 14 0 0 0 14 14h36a14 14 0 0 0 14-14V48a14 14 0 0 0-14-14Zm2 174a2 2 0 0 1-2 2h-36a2 2 0 0 1-2-2V48a2 2 0 0 1 2-2h36a2 2 0 0 1 2 2ZM92 34H56a14 14 0 0 0-14 14v160a14 14 0 0 0 14 14h36a14 14 0 0 0 14-14V48a14 14 0 0 0-14-14Zm2 174a2 2 0 0 1-2 2H56a2 2 0 0 1-2-2V48a2 2 0 0 1 2-2h36a2 2 0 0 1 2 2Z"
                /></svg
              >
            {/if}
          </button>
        {/if}
        <button
          aria-label="Start/stop recording"
          on:click={() => (recording ? stopRecording() : record())}
        >
          {#if recording}
            <svg width="32" height="32" viewBox="0 0 256 256"
              ><path
                fill="currentColor"
                d="M197.1 212H58.9A14.9 14.9 0 0 1 44 197.1V58.9A14.9 14.9 0 0 1 58.9 44h138.2A14.9 14.9 0 0 1 212 58.9v138.2a14.9 14.9 0 0 1-14.9 14.9ZM60 196h136V60H60Z"
              /></svg
            >
          {:else}
            <svg width="32" height="32" viewBox="0 0 256 256"
              ><path
                fill="currentColor"
                d="M128 24a104 104 0 1 0 104 104A104.2 104.2 0 0 0 128 24Zm0 192a88 88 0 1 1 88-88a88.1 88.1 0 0 1-88 88Zm0-160a72 72 0 1 0 72 72a72.1 72.1 0 0 0-72-72Zm0 128a56 56 0 1 1 56-56a56 56 0 0 1-56 56Z"
              /></svg
            >
          {/if}
        </button>
      </div>
      {#if recording}
        <h2 class="tr_list_header">Tracks</h2>
        <div class="track_list">
          {#each tracks as track}
            <div class="track">
              <span class="title">{track.lbl}</span>
              <div class="buttons">
                <button
                  aria-label="Pause or resume track"
                  class="pause_resume"
                  on:click={() => (track.enabled = !track.enabled)}
                >
                  {#if track.kind === "video"}
                    {#if track.enabled}
                      <svg width="32" height="32" viewBox="0 0 256 256"
                        ><path
                          fill="currentColor"
                          d="M244 73.1a7.7 7.7 0 0 0-8 0l-44 25.1V92a40 40 0 0 0-40-40H24A16 16 0 0 0 8 68v96a40 40 0 0 0 40 40h128a16 16 0 0 0 16-16v-30.2l44 25.1a8.3 8.3 0 0 0 4 1.1a8 8 0 0 0 4-1.1a7.8 7.8 0 0 0 4-6.9V80a7.8 7.8 0 0 0-4-6.9ZM176 188H48a24.1 24.1 0 0 1-24-24V68h128a24.1 24.1 0 0 1 24 24v96Zm56-25.8l-40-22.8v-22.8l40-22.8Z"
                        /></svg
                      >
                    {:else}
                      <svg width="32" height="32" viewBox="0 0 256 256"
                        ><path
                          fill="currentColor"
                          d="M244 73.1a7.7 7.7 0 0 0-8 0l-44 25.1V68a16 16 0 0 0-16-16h-65.1a8 8 0 0 0 0 16H176v76a7.8 7.8 0 0 0 4 6.9l56 32a8.3 8.3 0 0 0 4 1.1a8 8 0 0 0 4-1.1a7.8 7.8 0 0 0 4-6.9V80a7.8 7.8 0 0 0-4-6.9Zm-12 89.1l-40-22.8v-22.8l40-22.8ZM40.8 18.6a7.9 7.9 0 0 0-11.3-.5a8 8 0 0 0-.5 11.3L49.6 52H24A16 16 0 0 0 8 68v120a16 16 0 0 0 16 16h152a15.9 15.9 0 0 0 9.1-2.9l33 36.3a8 8 0 0 0 5.9 2.6a8.2 8.2 0 0 0 5.4-2.1a7.9 7.9 0 0 0 .5-11.3ZM24 188V68h40.1l109.1 120Z"
                        /></svg
                      >
                    {/if}
                  {:else if track.kind === "audio"}
                    {#if track.enabled}
                      <svg width="32" height="32" viewBox="0 0 256 256"
                        ><path
                          fill="currentColor"
                          d="M128 176a48 48 0 0 0 48-48V64a48 48 0 0 0-96 0v64a48 48 0 0 0 48 48ZM96 64a32 32 0 0 1 64 0v64a32 32 0 0 1-64 0Zm111.5 72.9a79.9 79.9 0 0 1-71.5 70.7V232a8 8 0 0 1-16 0v-24.4a79.9 79.9 0 0 1-71.5-70.7a8 8 0 1 1 15.9-1.8a64 64 0 0 0 127.2 0a8 8 0 1 1 15.9 1.8Z"
                        /></svg
                      >
                    {:else}
                      <svg width="32" height="32" viewBox="0 0 256 256"
                        ><path
                          fill="currentColor"
                          d="m213.9 210.6l-160-176a8 8 0 0 0-11.8 10.8L80 87.1V128a48 48 0 0 0 73.9 40.4l10.9 12a64 64 0 0 1-100.4-45.3a8 8 0 1 0-15.9 1.8a79.9 79.9 0 0 0 71.5 70.7V232a8 8 0 0 0 16 0v-24.4a79.2 79.2 0 0 0 39.6-15.3l26.5 29.1a8 8 0 0 0 5.9 2.6a8.2 8.2 0 0 0 5.4-2.1a7.9 7.9 0 0 0 .5-11.3ZM128 160a32.1 32.1 0 0 1-32-32v-23.3l46.9 51.6A31.6 31.6 0 0 1 128 160ZM87.2 38.8A47.5 47.5 0 0 1 128 16a48 48 0 0 1 48 48v60.4a8 8 0 0 1-16 0V64a32.1 32.1 0 0 0-32-32a31.7 31.7 0 0 0-27.2 15.2a8.1 8.1 0 0 1-11.1 2.6a8 8 0 0 1-2.5-11Zm100.4 112.5a60.1 60.1 0 0 0 4-16.2a8 8 0 1 1 15.9 1.8a78.7 78.7 0 0 1-5 20.2a7.8 7.8 0 0 1-7.4 5.1a9.3 9.3 0 0 1-2.9-.5a8.1 8.1 0 0 1-4.6-10.4Z"
                        /></svg
                      >
                    {/if}
                  {/if}
                </button>
                <button
                  aria-label="Stop track"
                  class="stop"
                  on:click={() => stopTrack(track)}
                >
                  <svg width="32" height="32" viewBox="0 0 256 256"
                    ><path
                      fill="currentColor"
                      d="M197.1 212H58.9A14.9 14.9 0 0 1 44 197.1V58.9A14.9 14.9 0 0 1 58.9 44h138.2A14.9 14.9 0 0 1 212 58.9v138.2a14.9 14.9 0 0 1-14.9 14.9ZM60 196h136V60H60Z"
                    /></svg
                  >
                </button>
              </div>
            </div>
          {/each}
          <!-- TODO: Add track -->
        </div>
      {/if}
      {#if !recording}
        <div class="select">
          <h2>Video device</h2>
          <select bind:value={videoSelect}>
            <option value="screen">Screen</option>
            <option value="camera">Webcam</option>
            <option value="mix">Overlay webcam on screen</option>
          </select>
          <details>
            <summary>Additional video options</summary>
            <b>Start recording when:</b>
            <select
              bind:value={videoStartWhen}
              aria-label="When to start recording"
            >
              <option value="immediately">Immediately</option>
              <option value="blur">When you leave this page</option>
              <option value="delay">In 5 seconds</option>
            </select>
            <b>Video ideal resolution</b>
            <div class="resolution">
              <input
                aria-label="Ideal video width"
                type="text"
                bind:value={videoConstraints.width}
                placeholder="Width"
              />x<input
                aria-label="Ideal video height"
                bind:value={videoConstraints.height}
                placeholder="Height"
                type="text"
              />
            </div>
            <b>Ideal video framerate</b>
            <input
              aria-label="Ideal framerate"
              type="text"
              bind:value={videoConstraints.frameRate.ideal}
            />
          </details>
          <h2>Audio device</h2>
          <select bind:value={audioSelect} aria-label="Audio source">
            <option value="system">System audio</option>
            <option value="microphone">Mic audio</option>
            <option value="both">Both system and mic</option>
            <option value="none">No audio</option>
          </select>
          <details>
            <summary>Additional audio options</summary>
            <!-- prettier-ignore -->
            <label><input bind:checked={audioConstraints.autoGainControl} type="checkbox"> Auto gain control</label>
            <!-- prettier-ignore -->
            <label><input bind:checked={audioConstraints.echoCancellation} type="checkbox"> Echo cancellation</label>
            <!-- prettier-ignore -->
            <label><input bind:checked={audioConstraints.noiseSuppression} type="checkbox"> Noise supression</label>
          </details>
          <h2>Output format</h2>
          <select bind:value={mime} aria-label="Recording output format">
            {#each Object.keys(MIME_TYPES).filter( (i) => MediaRecorder.isTypeSupported(i) ) as type}
              <option value={type}>
                .{getExtension(type)}
                {type.split("/")[0]}
                {#if type.split(";").length > 1}({type.split(";")[1]}){/if}
              </option>
            {/each}
          </select>
        </div>
      {/if}
    {/if}
  </div>
</div>

<style lang="less">
  @import "main.less";
  :global(body) {
    padding: 0;
    margin: 0;
  }
  .outer {
    .flex();
    width: 100vw;
    height: 100vh;
  }
  .conversion_output {
    font-family: "Courier New", Courier, monospace;
    padding: 10px;
    border-radius: 3px;
    border: 1px solid #ccc;
    white-space: pre;
    word-break: keep-all;
    overflow-wrap: normal;
    overflow: scroll;
    max-height: 300px;
  }
  :is(.done, .error, .conversion) .buttons {
    display: flex;
    width: 100%;
    gap: 0.2rem;
    flex-direction: column;
    margin-top: 15px;
    button {
      height: auto !important;
      flex: 1;
      width: 100% !important;
      padding: 10px 20px !important;
    }
  }

  .container {
    display: flex;
    width: 80vw;
    max-width: 400px;
    overflow-y: scroll;
    max-height: 80vh;
    justify-content: flex-start !important;

    &.conversion:not(.error) {
      max-width: 600px;
      padding-top: 0px !important;
      position: relative;
      h2 {
        margin-top: 0 !important;
        position: sticky;
        top: -1px;
        width: 100%;
        background: white;
        padding: 10px 0;
      }
      details {
        margin-top: 20px;
      }
      img,
      video {
        border-radius: 5px;
        box-shadow: rgba(50, 50, 93, 0.25) 0px 2px 5px -1px,
          rgba(0, 0, 0, 0.3) 0px 1px 3px -1px;
      }
    }
    margin: 0 auto;
    border: 1px dashed #ccc;
    border-radius: 10px;
    box-shadow: rgba(17, 12, 46, 0.15) 0px 48px 100px 0px;
    flex-direction: column;
    justify-content: center;
    align-items: center;
    padding: 40px;
    :global(video) {
      width: 100%;
      border: 1px solid;
      border-radius: 6px;
      border: 1px solid #eee;
    }
    .start_stop {
      display: flex;
      gap: 0.5rem;
      color: #666;
      margin-top: 1.2rem;
    }
    .tr_list_header {
      margin-top: 2rem;
      font-weight: 200;
    }

    .track_list {
      width: 80%;
      display: flex;
      flex-direction: column;
      gap: 0.6rem;

      .track {
        border-radius: 5px;
        font-style: italic;
        font-size: 1.1rem;
        color: #333;
        padding: 1.2rem 1.4rem;
        position: relative;
        display: flex;
        justify-content: space-between;
        align-items: center;
        box-shadow: rgba(0, 0, 0, 0.05) 0px 6px 24px 0px,
          rgba(0, 0, 0, 0.08) 0px 0px 0px 1px;
        &:hover {
          box-shadow: rgba(99, 99, 99, 0.2) 0px 2px 8px 0px;
        }
        .buttons {
          position: absolute;
          right: 0.3rem;
        }
        .buttons button {
          background: transparent;
          font-size: 0.3rem;
          padding: 5px;
          cursor: pointer;
          border: none;
          &:hover {
            background: #0001;
          }
          border-radius: 3px;
          svg {
            color: #777;
          }
        }
      }
    }
    button:not(.track button) {
      display: grid;
      place-items: center;
      @btn_size: 80px;
      width: @btn_size;
      height: @btn_size;
      background: transparent;
      cursor: pointer;
      border-radius: 4px;
      transition: transform 0.2s ease, box-shadow 0.3s ease,
        background-color 0.1s ease, color 0.2s ease;
      svg {
        @size: 60px;
        width: @size;
        height: @size;
      }
      &:hover {
        background: #333;
        color: #fff;
        transform: translateY(-5px);
        box-shadow: 2px 5px 10px -4px #0004;
      }
    }
    .select {
      width: 80%;
    }
    select {
      width: 100%;
      border-radius: 3px;
      border: 1px dashed #ccc;
      background: transparent;
      &:focus {
        outline: none;
        box-shadow: 1px 0px 3px 0 #0003;
      }
    }
  }
  .done span {
    margin-bottom: 20px;
    .optimize {
      font-style: italic;
      text-decoration: underline;
      cursor: pointer;
      font-weight: bold;
      transition: background 0.3s ease, color 0.2s ease;
      &:hover {
        background: #333;
        color: #fff;
      }
    }
  }
  details {
    border: 1px dashed #ccc;
    padding: 0.5em 0.5em 0;
    border-radius: 5px;
    margin-bottom: 5px;
    summary {
      list-style: none;
      font-weight: bold;
      margin: -0.5em -0.5em 0;
      padding: 0.5em;
      cursor: pointer;
      border: 1px solid transparent;
      transition: border-bottom-color 0.3s ease;
      &::before {
        content: "➜";
        margin-right: 6px;
        color: #999;
        transition: transform 0.3s ease;
        display: inline-block;
      }
      &:is([open] summary)::before {
        transform: rotate(90deg);
      }
    }
    &[open] summary {
      border-bottom-color: #ccc;
    }
  }
  details {
    input {
      width: 100%;
    }
    b {
      display: block;
      margin: 10px 0;
      font-size: 1.1rem;
      font-weight: 200;
    }
  }
  .resolution {
    display: flex;
    width: 100%;
    align-items: center;
    justify-content: center;
    input {
      max-width: 50px;
      margin: 0 5px;
    }
  }
  details[open] summary {
    margin-bottom: 10px !important;
  }
  details summary {
    display: flex;
    align-items: center;
  }
</style>

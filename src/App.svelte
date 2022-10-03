<script>
  import * as ebml from "./ts-ebml.min.js";
  import notifs from "./notifs.js";
  import ToastContainer from "./ToastContainer.svelte";
  import alterVid from "./canvasVid.js";
  import { onMount } from "svelte";

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
    conversion_opts;

  //MediaRecorder
  let recorder;
  //Selects
  let videoSelect = "screen",
    audioSelect = "system";
  let recording = false;

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

  onMount(() => {
    worker = new Worker("worker.js");
    worker.onmessage = function (event) {
      var message = event.data;
      if (message.type == "ready") {
        console.log("Loaded worker");
        worker.postMessage({
          type: "command",
          arguments: ["-help"],
        });
      } else if (message.type == "stdout") {
        console.log(message.data);
        conversionOutput += "\n" + message.data;
      } else if (message.type == "start") {
        conversionOutput = "";
        console.log("Worker got command");
      } else if (message.type === "done") {
        console.log(message);
      }
    };

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
    } else {
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
        maxWidth: videoConstraints.width,
      });
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
      ...audioStream.getTracks(),
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
    });
    setTimeout(() => {
      recorder.start();
    });
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
      out.video = videoConstraints;
    }
    if (a.audio === true) {
      out.audio = audioConstraints;
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
    return MIME_TYPES[type] || type.split("/")[0];
  }
  function addFilesToConversion() {
    conversion_opts = {
      files: [
        {
          name: "input.webm",
          data: readAsArrayBuffer(output),
        },
      ],
    };
  }
</script>

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
        <button on:click={() => location.reload()}>Reload page</button>
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
          on:click={() =>
            saveBlob(output, "Screen Recording." + output.type.split("/")[1])}
          >Download</button
        >
        <button on:click={() => location.reload()}>Re-record</button>
        <button on:click={() => addFilesToConversion()}>Convert</button>
      </div>
    {:else if conversionScreen}
      <div class="buttons">
        <h2>Convert video file</h2>
        <div class="buttons">
          <button
            on:click={() => (
              worker.postMessage({
                type: "command",
                arguments: [
                  "-t",
                  "5",
                  "-i",
                  "input.webm",
                  "-vf",
                  "showinfo",
                  "-strict",
                  "-2",
                  "output.gif",
                ],
                ...conversion_opts,
              }),
              (converting = true)
            )}>Start converting</button
          >
        </div>
        {#if converting}
          <pre class="conversion_output">{conversionOutput}</pre>
        {/if}
        {#if conversionDone}
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
              on:click={() =>
                saveBlob(
                  output,
                  "Screen Recording." + output.type.split("/")[1]
                )}>Download</button
            >
            <button on:click={() => location.reload()}>Re-convert</button>
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
        <button on:click={() => (recording ? stopRecording() : record())}>
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
                <button class="stop" on:click={() => stopTrack(track)}>
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
          <h2>Audio device</h2>
          <select bind:value={audioSelect}>
            <option value="system">System audio</option>
            <option value="microphone">Mic audio</option>
            <option value="both">Both system and mic</option>
          </select>
          <h2>Output format</h2>
          <select bind:value={mime}>
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
</style>

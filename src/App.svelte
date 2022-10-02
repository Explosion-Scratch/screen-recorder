<script>
  import * as ebml from "./ts-ebml.min.js";

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
    fixing = false,
    fixed = false;
  //MediaRecorder
  let recorder;
  //Selects
  let videoSelect = "screen",
    audioSelect = "system";
  let recording = false;
  import { onMount } from "svelte";

  onMount(() => {});

  async function startRecording() {
    fixed = false;
    fixing = false;
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

    if (external.audio || external.video) {
      console.log("Getting from external", external);
      let _stream = await navigator.mediaDevices.getUserMedia(external);
      tracks = [...tracks, ..._stream.getTracks()];
      console.log("Got stream");
      if (external.audio) {
        let tracks = _stream.getAudioTracks();
        if (!tracks.length) {
          throw new Error("No audio stream found");
        }
        audioStream = new MediaStream(tracks);
      }
      if (external.video) {
        let tracks = _stream.getVideoTracks();
        if (!tracks.length) {
          throw new Error("No video stream found");
        }
        videoStream = new MediaStream(tracks);
      }
    }
    if (screen.audio || screen.video) {
      console.log("Getting from screen", screen);
      let _stream = await navigator.mediaDevices.getDisplayMedia(screen);
      tracks = [...tracks, ..._stream.getTracks()];
      console.log("Got stream");
      if (screen.audio) {
        let tracks = _stream.getAudioTracks();
        if (!tracks.length) {
          throw new Error("No audio stream found");
        }
        audioStream = new MediaStream(tracks);
      }
      if (screen.video) {
        let tracks = _stream.getVideoTracks();
        if (!tracks.length) {
          throw new Error("No video stream found");
        }
        videoStream = new MediaStream(tracks);
      }
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
    recorder = new MediaRecorder(combinedStream);
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
    let vid = document.createElement("video");
    vid.setAttribute("playsinline", "true");
    vid.setAttribute("autoplay", "true");
    vid.setAttribute("muted", "true");
    vid.srcObject = combinedStream;
    preview.appendChild(vid);
    recorder.ondataavailable = (e) => {
      chunks.push(e.data);
    };
    recorder.onpause = () => {
      paused = true;
    };
    recorder.onresume = () => {
      paused = false;
    };
    // preview.srcObject = combinedStream;
    // Set variables at the end in case of error
    paused = false;
    recording = true;
  }
  function stopRecording() {
    tracks.forEach((track) => track.stop());
    recorder.onstop = () => {
      output = new Blob(chunks, { type: recorder.mimeType });
      done = true;
    };
    recorder.addEventListener("dataavailable", () => {
      //requestData needs to have state: recording
      try {
        recorder.stop();
      } catch (e) {}
    });
    recorder.requestData();
    paused = false;
    recording = false;
  }
  function stopTrack(track) {
    if (!tracks.includes(track)) {
      throw new Error("Couldn't find track in list");
    }
    tracks = tracks.filter((i) => i !== track);
    combinedStream.removeTrack(track);
  }
  async function fixBlob(blob) {
    fixing = true;
    const { Decoder, Encoder, tools, Reader } = ebml;
    const decoder = new Decoder();
    const reader = new Reader();
    reader.logging = true;
    reader.logGroup = "Raw WebM file";
    reader.drop_default_duration = false;
    const webMBuf = await readAsArrayBuffer(blob);
    const elms = decoder.decode(webMBuf);
    elms.forEach((elm) => {
      reader.read(elm);
    });
    reader.stop();
    const refinedMetadataBuf = tools.makeMetadataSeekable(
      reader.metadatas,
      reader.duration,
      reader.cues
    );
    const body = webMBuf.slice(reader.metadataSize);
    const refinedWebM = new Blob([refinedMetadataBuf, body], {
      type: "video/webm",
    });
    output = refinedWebM;
    fixing = false;
    fixed = true;
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
</script>

<div class="outer">
  <div class="container" class:done>
    {#if done}
      <h2>Done!</h2>
      <!-- {#if output.type.includes("/webm")} -->
      <span>
        {#if fixing}
          Fixing...
        {:else}
          This video isn't seekable due to browser restrictions, <span
            class="optimize"
            on:click={() => fixBlob(output)}>try to fix?</span
          >
        {/if}
      </span>
      <!-- {/if} -->
      <video src={URL.createObjectURL(output)} />
      <div class="buttons">
        <button>Download</button><button>Re-record</button>
      </div>
    {:else}
      <div
        bind:this={preview}
        class="preview"
        style:display={recording ? "block" : "none"}
      />
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
        <button
          on:click={() => (recording ? stopRecording() : startRecording())}
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
              <span class="title">{track.label}</span>
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
          </select>
          <h2>Audio device</h2>
          <select bind:value={audioSelect}>
            <option value="system">System audio</option>
            <option value="microphone">Mic audio</option>
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
  .done .buttons {
    display: flex;
    width: 100%;
    gap: 0.2rem;
    flex-direction: column;
    margin-top: 15px;
    button {
      height: auto !important;
      flex: 1;
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
</style>

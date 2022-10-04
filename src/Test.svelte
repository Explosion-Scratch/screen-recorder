<script>
  import { createFFmpeg, fetchFile } from "@ffmpeg/ffmpeg/dist/ffmpeg.min.js";
  import { onMount } from "svelte";
  let video, upload;
  let ffmpeg;
  onMount(() => {
    ffmpeg = createFFmpeg({ log: true });
    if (window.SharedArrayBuffer && !ffmpeg.isLoaded()) {
      ffmpeg.load();
      window.ffmpeg = ffmpeg;
    }
  });
  const transcode = async ({ target: { files } }) => {
    const { name } = files[0];
    await ffmpeg.load();
    ffmpeg.FS("writeFile", name, await fetchFile(files[0]));
    await ffmpeg.run("-i", name, "output.mp4");
    const data = ffmpeg.FS("readFile", "output.mp4");
    video.src = URL.createObjectURL(
      new Blob([data.buffer], { type: "video/mp4" })
    );
  };
</script>

<video bind:this={video} />
<input type="file" bind:this={upload} on:change={transcode} id="uploader" />
<svelte:head><script src="coi-serviceworker.min.js"></script></svelte:head>

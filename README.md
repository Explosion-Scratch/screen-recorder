<div align="center">
  <h1>Svelte Screen Recorder</h1>
</div>
<div align="center"><span>Pause + Resume • Device select • Make recordings seekable • Browser Based • Convert in browser with FFmpeg</span></div>

![Demo](demo.gif)

<center><i>That's what it looks like</i></center>

## Features

- Highly customizeable
  - Customize everything about recording, output, etc
- Fix broken recordings
- Pause and resume recordings
- Select from multiple devices
- Convert with FFmpeg
  - Support for all major codecs
  - Custom FFmpeg commands supported -> Convert to any file type in browser
- Error catching
  - Don't lose precious recordings

## Libraries used

- ts-ebml: Used to make webm files recorded by the [MediaRecorder](https://devdocs.io/dom/mediarecorder) api seekable
  - This library didn't work in browser correctly and hadn't been updated for a while.
  - Thanks to @guest271314 for [this comment](https://github.com/legokichi/ts-ebml/issues/14#issuecomment-1025186091) which linked a compiled version for the browser
- FFMPEG.WASM
  - WebAssembly version of FFmpeg. This also didn't work due to restrictions on [SharedArrayBuffers](https://devdocs.io/javascript/global_objects/sharedarraybuffer)
  - I eventually got it working using a [ServiceWorker which lifts cross origin restrictions](https://github.com/gzuidhof/coi-serviceworker) - (This is why the app reloads on the initial page load)
- I got the parseArguments function from [VideoConverter.js](https://bgrins.github.io/videoconverter.js/), a browser version of FFmpeg that ended up not working due to being created in 2014.
- The toast notifications were from [my svelte components repo](https://github.com/explosion-scratch/components)

importScripts(
  "https://rawcdn.githack.com/bgrins/videoconverter.js/42def8c4136b03cbe55951fbf6fcda214f51059a/build/ffmpeg-all-codecs.js"
);

function print(text) {
  postMessage({
    type: "stdout",
    data: text,
  });
}
onmessage = function (event) {
  var module = {
    files: event.data.files || [],
    arguments: event.data.arguments || [],
    print: print,
    printErr: print,
  };
  postMessage({
    type: "start",
    data: module.arguments,
  });
  var result = ffmpeg_run(module);
  postMessage({
    type: "done",
    data: result,
  });
};

postMessage({
  type: "ready",
});

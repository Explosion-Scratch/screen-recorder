/**
 * Callback called every frame
 *
 * @callback vidCallback
 * @param {Boolean} done If the video frame is done
 * @param {VideoFrame} frame A VideoFrame object that can be drawn on canvas
 * @param {HTMLCanvasElement} canvas The Canvas element
 * @param {MediaStreamTrack} track The video stream track
 */

/**
 * Params object passed
 * @typedef {Object} Details
 * @property {MediaStreamTrack} track A track from a video stream
 * @property {vidCallback} [cb=() => {}] The callback, called every frame
 * @property {Boolean} [show=false] Whether to show the canvas
 * @property {Function} [init=() => {}] Init function
 * @property {Function} [done=()=> {}] Function called when finished
 */
/**
 * @typedef {Object} AlterVideoReturn
 * @property {HTMLCanvasElement} canvas The HTML canvas element
 * @property {MediaStreamTrack} track The track
 * @property {vidCallback} cb
 * @property {Boolean} show Whether or not to show the canvas
 * @property {Function} init Init function
 * @property {Function} done Function called when finished
 * @property {Function} drawStream
 * @property {MediaStream} stream Output stream from canvas
 * @property {Function} stop Function to destroy
 */

/**
 * Alters a video stream using canvas
 * @param {*} details
 * @returns {AlterVidReturn}
 */
export default async function ({
  track,
  cb = ({ ctx, frame, canvas }) => {
    if (!(frame && ctx && canvas)) {
      return console.error("ctx, frame or canvas nonexistant: ", {
        ctx,
        frame,
        canvas,
      });
    }
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(frame, 0, 0);
  },
  show = false,
  init = () => {},
  done = () => {},
  canvas,
  ctx,
}) {
  let stillGoing = true;
  if (!track) {
    throw new Error("Expected track");
  }

  if (!(canvas && ctx)) {
    canvas = document.createElement("canvas");
    ctx = canvas.getContext("2d");
  }
  if (!canvas) {
    canvas = ctx.canvas;
  }
  if (!ctx) {
    ctx = canvas.getContext("2d");
  }

  await init({ track, canvas });
  drawStream(track, cb, done, canvas);

  function drawStream(track, cb = () => {}, done = () => {}, canvas) {
    const processor = new MediaStreamTrackProcessor(track);
    const reader = processor.readable.getReader();
    chunk();
    function chunk() {
      reader.read().then(async (a) => {
        if (
          canvas.width !== a.displayWidth ||
          canvas.height !== a.displayHeight
        ) {
          canvas.width = a.displayWidth;
          canvas.height = a.displayHeight;
        }
        await cb({ done: a.done, frame: a.value, canvas, track, ctx });
        if (a.done || !stillGoing) {
          done({ done: true, frame: a.value, canvas, track });
        } else {
          chunk();
        }
        a.value.close();
      });
    }
  }

  const stream = canvas.captureStream();

  return {
    canvas,
    track,
    cb,
    show,
    init,
    done,
    drawStream,
    stream,
    stop: () => {
      stillGoing = false;
      return;
    },
  };
}

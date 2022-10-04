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
 * @property {CanvasRenderingContext2d} [ctx] Canvas context
 * @property {HTMLCanvasElement} canvas Canvas element
 * @property {Boolean} [setSize=false] Set the size of the canvas based on the frame?
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
  fps = 30,
  maxWidth = 1280,
  setSize = true,
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

  console.log(track);

  await init({ track, canvas });
  drawStream(track, cb, done, canvas);

  function drawStream(track, cb = () => {}, done = () => {}, canvas) {
    const processor = new MediaStreamTrackProcessor(track);
    const reader = processor.readable.getReader();
    chunk();
    let frame = 0;
    function chunk() {
      reader.read().then((a) => {
        //Resize max every 50 frames
        if (setSize && frame % 50 === 0) {
          let w =
            a.value.displayWidth > maxWidth ? maxWidth : a.value.displayWidth;
          // Find ratio between actual width and ideal width and size
          let h =
            a.value.displayWidth > maxWidth
              ? a.value.displayHeight * (maxWidth / a.value.displayWidth)
              : a.value.displayHeight;
          if (canvas.width !== w) {
            canvas.width = w;
          }
          if (canvas.hiehgt !== h) {
            canvas.height = h;
          }
        }
        frame++;
        cb({ done: a.done, frame: a.value, canvas, track, ctx });
        if (a.done || !stillGoing) {
          done({ done: true, frame: a.value, canvas, track });
          a.value.close();
        } else {
          a.value.close();
          setTimeout(chunk, 1000 / fps);
        }
      });
    }
  }

  const stream = canvas.captureStream();
  stream.getTracks()[0].lbl = "Canvas video track";

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

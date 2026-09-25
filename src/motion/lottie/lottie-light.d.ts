// The ESM light canvas build of lottie-web (no eval, no `new Function`: safe under the app's CSP)
// ships without its own declaration; it has the same API as the package root.
declare module 'lottie-web/build/player/esm/lottie_light_canvas.min.js' {
  import Lottie from 'lottie-web';
  export default Lottie;
}

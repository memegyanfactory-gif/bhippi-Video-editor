// Animate.css (animate.style, v4.1.1, Hippocratic 2.1 / formerly MIT) — all 97 animations, rebuilt for video.
//
// The keyframes are the compiled stylesheet's, verbatim, renamed `rbx-ac-<kebab>` and with every non-zero
// pixel length scaled by `--u` (`3000px` → `calc(3000px * var(--u))`, `perspective(400px)` included, so
// flips keep their depth on any canvas). Percentages, per-keyframe timing functions, transforms and
// opacities are untouched. The `.animate__<name>` class rules — duration multipliers (bounceIn .75 s,
// heartBeat 1.3 s, hinge 2 s), timing functions, transform origins and backface visibility — are kept in
// RULES so `animateCssEntrance()` reproduces the library's own defaults.
//
// Bits: one per animation, wrapping the shared glass card or bare hero text (`mode`).
//   - entrances play at 0.1 s as a paused `.a` animation and hold;
//   - attention seekers fade the copy on first, then play from 0.45 s (`repeat` times);
//   - exits fade the copy on, hold, then play over the clip's final moments on the `--exit` clock, so a
//     layer's `until` moves them too; every entrance and attention seeker takes an optional `exit`.
// Nothing here depends on wall-clock time, a pointer, or an external resource.

import {
  CARD_PROPS, N, S, accentStyle, bit, card, clampN, d, esc, px, textOf,
  type Bit, type BitContext, type BitLevel, type BitOutput, type BitProp, type BitProps,
} from '../core';

type AcRule = { dur?: number; timing?: string; origin?: string; backface?: boolean };

export const ANIMATE_CSS_KEYFRAMES: Record<string, string> = {
  bounce: '@keyframes rbx-ac-bounce{from,20%,53%,to{animation-timing-function:cubic-bezier(0.215,0.61,0.355,1);transform:translate3d(0,0,0)}40%,43%{animation-timing-function:cubic-bezier(0.755,0.05,0.855,0.06);transform:translate3d(0,calc(-30px * var(--u)),0) scaleY(1.1)}70%{animation-timing-function:cubic-bezier(0.755,0.05,0.855,0.06);transform:translate3d(0,calc(-15px * var(--u)),0) scaleY(1.05)}80%{transition-timing-function:cubic-bezier(0.215,0.61,0.355,1);transform:translate3d(0,0,0) scaleY(0.95)}90%{transform:translate3d(0,calc(-4px * var(--u)),0) scaleY(1.02)}}',
  flash: '@keyframes rbx-ac-flash{from,50%,to{opacity:1}25%,75%{opacity:0}}',
  pulse: '@keyframes rbx-ac-pulse{from{transform:scale3d(1,1,1)}50%{transform:scale3d(1.05,1.05,1.05)}to{transform:scale3d(1,1,1)}}',
  rubberBand: '@keyframes rbx-ac-rubber-band{from{transform:scale3d(1,1,1)}30%{transform:scale3d(1.25,0.75,1)}40%{transform:scale3d(0.75,1.25,1)}50%{transform:scale3d(1.15,0.85,1)}65%{transform:scale3d(0.95,1.05,1)}75%{transform:scale3d(1.05,0.95,1)}to{transform:scale3d(1,1,1)}}',
  shakeX: '@keyframes rbx-ac-shake-x{from,to{transform:translate3d(0,0,0)}10%,30%,50%,70%,90%{transform:translate3d(calc(-10px * var(--u)),0,0)}20%,40%,60%,80%{transform:translate3d(calc(10px * var(--u)),0,0)}}',
  shakeY: '@keyframes rbx-ac-shake-y{from,to{transform:translate3d(0,0,0)}10%,30%,50%,70%,90%{transform:translate3d(0,calc(-10px * var(--u)),0)}20%,40%,60%,80%{transform:translate3d(0,calc(10px * var(--u)),0)}}',
  headShake: '@keyframes rbx-ac-head-shake{0%{transform:translateX(0)}6.5%{transform:translateX(calc(-6px * var(--u))) rotateY(-9deg)}18.5%{transform:translateX(calc(5px * var(--u))) rotateY(7deg)}31.5%{transform:translateX(calc(-3px * var(--u))) rotateY(-5deg)}43.5%{transform:translateX(calc(2px * var(--u))) rotateY(3deg)}50%{transform:translateX(0)}}',
  swing: '@keyframes rbx-ac-swing{20%{transform:rotate3d(0,0,1,15deg)}40%{transform:rotate3d(0,0,1,-10deg)}60%{transform:rotate3d(0,0,1,5deg)}80%{transform:rotate3d(0,0,1,-5deg)}to{transform:rotate3d(0,0,1,0deg)}}',
  tada: '@keyframes rbx-ac-tada{from{transform:scale3d(1,1,1)}10%,20%{transform:scale3d(0.9,0.9,0.9) rotate3d(0,0,1,-3deg)}30%,50%,70%,90%{transform:scale3d(1.1,1.1,1.1) rotate3d(0,0,1,3deg)}40%,60%,80%{transform:scale3d(1.1,1.1,1.1) rotate3d(0,0,1,-3deg)}to{transform:scale3d(1,1,1)}}',
  wobble: '@keyframes rbx-ac-wobble{from{transform:translate3d(0,0,0)}15%{transform:translate3d(-25%,0,0) rotate3d(0,0,1,-5deg)}30%{transform:translate3d(20%,0,0) rotate3d(0,0,1,3deg)}45%{transform:translate3d(-15%,0,0) rotate3d(0,0,1,-3deg)}60%{transform:translate3d(10%,0,0) rotate3d(0,0,1,2deg)}75%{transform:translate3d(-5%,0,0) rotate3d(0,0,1,-1deg)}to{transform:translate3d(0,0,0)}}',
  jello: '@keyframes rbx-ac-jello{from,11.1%,to{transform:translate3d(0,0,0)}22.2%{transform:skewX(-12.5deg) skewY(-12.5deg)}33.3%{transform:skewX(6.25deg) skewY(6.25deg)}44.4%{transform:skewX(-3.125deg) skewY(-3.125deg)}55.5%{transform:skewX(1.5625deg) skewY(1.5625deg)}66.6%{transform:skewX(-0.78125deg) skewY(-0.78125deg)}77.7%{transform:skewX(0.390625deg) skewY(0.390625deg)}88.8%{transform:skewX(-0.1953125deg) skewY(-0.1953125deg)}}',
  heartBeat: '@keyframes rbx-ac-heart-beat{0%{transform:scale(1)}14%{transform:scale(1.3)}28%{transform:scale(1)}42%{transform:scale(1.3)}70%{transform:scale(1)}}',
  backInDown: '@keyframes rbx-ac-back-in-down{0%{transform:translateY(calc(-1200px * var(--u))) scale(0.7);opacity:0.7}80%{transform:translateY(0px) scale(0.7);opacity:0.7}100%{transform:scale(1);opacity:1}}',
  backInLeft: '@keyframes rbx-ac-back-in-left{0%{transform:translateX(calc(-2000px * var(--u))) scale(0.7);opacity:0.7}80%{transform:translateX(0px) scale(0.7);opacity:0.7}100%{transform:scale(1);opacity:1}}',
  backInRight: '@keyframes rbx-ac-back-in-right{0%{transform:translateX(calc(2000px * var(--u))) scale(0.7);opacity:0.7}80%{transform:translateX(0px) scale(0.7);opacity:0.7}100%{transform:scale(1);opacity:1}}',
  backInUp: '@keyframes rbx-ac-back-in-up{0%{transform:translateY(calc(1200px * var(--u))) scale(0.7);opacity:0.7}80%{transform:translateY(0px) scale(0.7);opacity:0.7}100%{transform:scale(1);opacity:1}}',
  backOutDown: '@keyframes rbx-ac-back-out-down{0%{transform:scale(1);opacity:1}20%{transform:translateY(0px) scale(0.7);opacity:0.7}100%{transform:translateY(calc(700px * var(--u))) scale(0.7);opacity:0.7}}',
  backOutLeft: '@keyframes rbx-ac-back-out-left{0%{transform:scale(1);opacity:1}20%{transform:translateX(0px) scale(0.7);opacity:0.7}100%{transform:translateX(calc(-2000px * var(--u))) scale(0.7);opacity:0.7}}',
  backOutRight: '@keyframes rbx-ac-back-out-right{0%{transform:scale(1);opacity:1}20%{transform:translateX(0px) scale(0.7);opacity:0.7}100%{transform:translateX(calc(2000px * var(--u))) scale(0.7);opacity:0.7}}',
  backOutUp: '@keyframes rbx-ac-back-out-up{0%{transform:scale(1);opacity:1}20%{transform:translateY(0px) scale(0.7);opacity:0.7}100%{transform:translateY(calc(-700px * var(--u))) scale(0.7);opacity:0.7}}',
  bounceIn: '@keyframes rbx-ac-bounce-in{from,20%,40%,60%,80%,to{animation-timing-function:cubic-bezier(0.215,0.61,0.355,1)}0%{opacity:0;transform:scale3d(0.3,0.3,0.3)}20%{transform:scale3d(1.1,1.1,1.1)}40%{transform:scale3d(0.9,0.9,0.9)}60%{opacity:1;transform:scale3d(1.03,1.03,1.03)}80%{transform:scale3d(0.97,0.97,0.97)}to{opacity:1;transform:scale3d(1,1,1)}}',
  bounceInDown: '@keyframes rbx-ac-bounce-in-down{from,60%,75%,90%,to{animation-timing-function:cubic-bezier(0.215,0.61,0.355,1)}0%{opacity:0;transform:translate3d(0,calc(-3000px * var(--u)),0) scaleY(3)}60%{opacity:1;transform:translate3d(0,calc(25px * var(--u)),0) scaleY(0.9)}75%{transform:translate3d(0,calc(-10px * var(--u)),0) scaleY(0.95)}90%{transform:translate3d(0,calc(5px * var(--u)),0) scaleY(0.985)}to{transform:translate3d(0,0,0)}}',
  bounceInLeft: '@keyframes rbx-ac-bounce-in-left{from,60%,75%,90%,to{animation-timing-function:cubic-bezier(0.215,0.61,0.355,1)}0%{opacity:0;transform:translate3d(calc(-3000px * var(--u)),0,0) scaleX(3)}60%{opacity:1;transform:translate3d(calc(25px * var(--u)),0,0) scaleX(1)}75%{transform:translate3d(calc(-10px * var(--u)),0,0) scaleX(0.98)}90%{transform:translate3d(calc(5px * var(--u)),0,0) scaleX(0.995)}to{transform:translate3d(0,0,0)}}',
  bounceInRight: '@keyframes rbx-ac-bounce-in-right{from,60%,75%,90%,to{animation-timing-function:cubic-bezier(0.215,0.61,0.355,1)}from{opacity:0;transform:translate3d(calc(3000px * var(--u)),0,0) scaleX(3)}60%{opacity:1;transform:translate3d(calc(-25px * var(--u)),0,0) scaleX(1)}75%{transform:translate3d(calc(10px * var(--u)),0,0) scaleX(0.98)}90%{transform:translate3d(calc(-5px * var(--u)),0,0) scaleX(0.995)}to{transform:translate3d(0,0,0)}}',
  bounceInUp: '@keyframes rbx-ac-bounce-in-up{from,60%,75%,90%,to{animation-timing-function:cubic-bezier(0.215,0.61,0.355,1)}from{opacity:0;transform:translate3d(0,calc(3000px * var(--u)),0) scaleY(5)}60%{opacity:1;transform:translate3d(0,calc(-20px * var(--u)),0) scaleY(0.9)}75%{transform:translate3d(0,calc(10px * var(--u)),0) scaleY(0.95)}90%{transform:translate3d(0,calc(-5px * var(--u)),0) scaleY(0.985)}to{transform:translate3d(0,0,0)}}',
  bounceOut: '@keyframes rbx-ac-bounce-out{20%{transform:scale3d(0.9,0.9,0.9)}50%,55%{opacity:1;transform:scale3d(1.1,1.1,1.1)}to{opacity:0;transform:scale3d(0.3,0.3,0.3)}}',
  bounceOutDown: '@keyframes rbx-ac-bounce-out-down{20%{transform:translate3d(0,calc(10px * var(--u)),0) scaleY(0.985)}40%,45%{opacity:1;transform:translate3d(0,calc(-20px * var(--u)),0) scaleY(0.9)}to{opacity:0;transform:translate3d(0,calc(2000px * var(--u)),0) scaleY(3)}}',
  bounceOutLeft: '@keyframes rbx-ac-bounce-out-left{20%{opacity:1;transform:translate3d(calc(20px * var(--u)),0,0) scaleX(0.9)}to{opacity:0;transform:translate3d(calc(-2000px * var(--u)),0,0) scaleX(2)}}',
  bounceOutRight: '@keyframes rbx-ac-bounce-out-right{20%{opacity:1;transform:translate3d(calc(-20px * var(--u)),0,0) scaleX(0.9)}to{opacity:0;transform:translate3d(calc(2000px * var(--u)),0,0) scaleX(2)}}',
  bounceOutUp: '@keyframes rbx-ac-bounce-out-up{20%{transform:translate3d(0,calc(-10px * var(--u)),0) scaleY(0.985)}40%,45%{opacity:1;transform:translate3d(0,calc(20px * var(--u)),0) scaleY(0.9)}to{opacity:0;transform:translate3d(0,calc(-2000px * var(--u)),0) scaleY(3)}}',
  fadeIn: '@keyframes rbx-ac-fade-in{from{opacity:0}to{opacity:1}}',
  fadeInDown: '@keyframes rbx-ac-fade-in-down{from{opacity:0;transform:translate3d(0,-100%,0)}to{opacity:1;transform:translate3d(0,0,0)}}',
  fadeInDownBig: '@keyframes rbx-ac-fade-in-down-big{from{opacity:0;transform:translate3d(0,calc(-2000px * var(--u)),0)}to{opacity:1;transform:translate3d(0,0,0)}}',
  fadeInLeft: '@keyframes rbx-ac-fade-in-left{from{opacity:0;transform:translate3d(-100%,0,0)}to{opacity:1;transform:translate3d(0,0,0)}}',
  fadeInLeftBig: '@keyframes rbx-ac-fade-in-left-big{from{opacity:0;transform:translate3d(calc(-2000px * var(--u)),0,0)}to{opacity:1;transform:translate3d(0,0,0)}}',
  fadeInRight: '@keyframes rbx-ac-fade-in-right{from{opacity:0;transform:translate3d(100%,0,0)}to{opacity:1;transform:translate3d(0,0,0)}}',
  fadeInRightBig: '@keyframes rbx-ac-fade-in-right-big{from{opacity:0;transform:translate3d(calc(2000px * var(--u)),0,0)}to{opacity:1;transform:translate3d(0,0,0)}}',
  fadeInUp: '@keyframes rbx-ac-fade-in-up{from{opacity:0;transform:translate3d(0,100%,0)}to{opacity:1;transform:translate3d(0,0,0)}}',
  fadeInUpBig: '@keyframes rbx-ac-fade-in-up-big{from{opacity:0;transform:translate3d(0,calc(2000px * var(--u)),0)}to{opacity:1;transform:translate3d(0,0,0)}}',
  fadeInTopLeft: '@keyframes rbx-ac-fade-in-top-left{from{opacity:0;transform:translate3d(-100%,-100%,0)}to{opacity:1;transform:translate3d(0,0,0)}}',
  fadeInTopRight: '@keyframes rbx-ac-fade-in-top-right{from{opacity:0;transform:translate3d(100%,-100%,0)}to{opacity:1;transform:translate3d(0,0,0)}}',
  fadeInBottomLeft: '@keyframes rbx-ac-fade-in-bottom-left{from{opacity:0;transform:translate3d(-100%,100%,0)}to{opacity:1;transform:translate3d(0,0,0)}}',
  fadeInBottomRight: '@keyframes rbx-ac-fade-in-bottom-right{from{opacity:0;transform:translate3d(100%,100%,0)}to{opacity:1;transform:translate3d(0,0,0)}}',
  fadeOut: '@keyframes rbx-ac-fade-out{from{opacity:1}to{opacity:0}}',
  fadeOutDown: '@keyframes rbx-ac-fade-out-down{from{opacity:1}to{opacity:0;transform:translate3d(0,100%,0)}}',
  fadeOutDownBig: '@keyframes rbx-ac-fade-out-down-big{from{opacity:1}to{opacity:0;transform:translate3d(0,calc(2000px * var(--u)),0)}}',
  fadeOutLeft: '@keyframes rbx-ac-fade-out-left{from{opacity:1}to{opacity:0;transform:translate3d(-100%,0,0)}}',
  fadeOutLeftBig: '@keyframes rbx-ac-fade-out-left-big{from{opacity:1}to{opacity:0;transform:translate3d(calc(-2000px * var(--u)),0,0)}}',
  fadeOutRight: '@keyframes rbx-ac-fade-out-right{from{opacity:1}to{opacity:0;transform:translate3d(100%,0,0)}}',
  fadeOutRightBig: '@keyframes rbx-ac-fade-out-right-big{from{opacity:1}to{opacity:0;transform:translate3d(calc(2000px * var(--u)),0,0)}}',
  fadeOutUp: '@keyframes rbx-ac-fade-out-up{from{opacity:1}to{opacity:0;transform:translate3d(0,-100%,0)}}',
  fadeOutUpBig: '@keyframes rbx-ac-fade-out-up-big{from{opacity:1}to{opacity:0;transform:translate3d(0,calc(-2000px * var(--u)),0)}}',
  fadeOutTopLeft: '@keyframes rbx-ac-fade-out-top-left{from{opacity:1;transform:translate3d(0,0,0)}to{opacity:0;transform:translate3d(-100%,-100%,0)}}',
  fadeOutTopRight: '@keyframes rbx-ac-fade-out-top-right{from{opacity:1;transform:translate3d(0,0,0)}to{opacity:0;transform:translate3d(100%,-100%,0)}}',
  fadeOutBottomRight: '@keyframes rbx-ac-fade-out-bottom-right{from{opacity:1;transform:translate3d(0,0,0)}to{opacity:0;transform:translate3d(100%,100%,0)}}',
  fadeOutBottomLeft: '@keyframes rbx-ac-fade-out-bottom-left{from{opacity:1;transform:translate3d(0,0,0)}to{opacity:0;transform:translate3d(-100%,100%,0)}}',
  flip: '@keyframes rbx-ac-flip{from{transform:perspective(calc(400px * var(--u))) scale3d(1,1,1) translate3d(0,0,0) rotate3d(0,1,0,-360deg);animation-timing-function:ease-out}40%{transform:perspective(calc(400px * var(--u))) scale3d(1,1,1) translate3d(0,0,calc(150px * var(--u))) rotate3d(0,1,0,-190deg);animation-timing-function:ease-out}50%{transform:perspective(calc(400px * var(--u))) scale3d(1,1,1) translate3d(0,0,calc(150px * var(--u))) rotate3d(0,1,0,-170deg);animation-timing-function:ease-in}80%{transform:perspective(calc(400px * var(--u))) scale3d(0.95,0.95,0.95) translate3d(0,0,0) rotate3d(0,1,0,0deg);animation-timing-function:ease-in}to{transform:perspective(calc(400px * var(--u))) scale3d(1,1,1) translate3d(0,0,0) rotate3d(0,1,0,0deg);animation-timing-function:ease-in}}',
  flipInX: '@keyframes rbx-ac-flip-in-x{from{transform:perspective(calc(400px * var(--u))) rotate3d(1,0,0,90deg);animation-timing-function:ease-in;opacity:0}40%{transform:perspective(calc(400px * var(--u))) rotate3d(1,0,0,-20deg);animation-timing-function:ease-in}60%{transform:perspective(calc(400px * var(--u))) rotate3d(1,0,0,10deg);opacity:1}80%{transform:perspective(calc(400px * var(--u))) rotate3d(1,0,0,-5deg)}to{transform:perspective(calc(400px * var(--u)))}}',
  flipInY: '@keyframes rbx-ac-flip-in-y{from{transform:perspective(calc(400px * var(--u))) rotate3d(0,1,0,90deg);animation-timing-function:ease-in;opacity:0}40%{transform:perspective(calc(400px * var(--u))) rotate3d(0,1,0,-20deg);animation-timing-function:ease-in}60%{transform:perspective(calc(400px * var(--u))) rotate3d(0,1,0,10deg);opacity:1}80%{transform:perspective(calc(400px * var(--u))) rotate3d(0,1,0,-5deg)}to{transform:perspective(calc(400px * var(--u)))}}',
  flipOutX: '@keyframes rbx-ac-flip-out-x{from{transform:perspective(calc(400px * var(--u)))}30%{transform:perspective(calc(400px * var(--u))) rotate3d(1,0,0,-20deg);opacity:1}to{transform:perspective(calc(400px * var(--u))) rotate3d(1,0,0,90deg);opacity:0}}',
  flipOutY: '@keyframes rbx-ac-flip-out-y{from{transform:perspective(calc(400px * var(--u)))}30%{transform:perspective(calc(400px * var(--u))) rotate3d(0,1,0,-15deg);opacity:1}to{transform:perspective(calc(400px * var(--u))) rotate3d(0,1,0,90deg);opacity:0}}',
  lightSpeedInRight: '@keyframes rbx-ac-light-speed-in-right{from{transform:translate3d(100%,0,0) skewX(-30deg);opacity:0}60%{transform:skewX(20deg);opacity:1}80%{transform:skewX(-5deg)}to{transform:translate3d(0,0,0)}}',
  lightSpeedInLeft: '@keyframes rbx-ac-light-speed-in-left{from{transform:translate3d(-100%,0,0) skewX(30deg);opacity:0}60%{transform:skewX(-20deg);opacity:1}80%{transform:skewX(5deg)}to{transform:translate3d(0,0,0)}}',
  lightSpeedOutRight: '@keyframes rbx-ac-light-speed-out-right{from{opacity:1}to{transform:translate3d(100%,0,0) skewX(30deg);opacity:0}}',
  lightSpeedOutLeft: '@keyframes rbx-ac-light-speed-out-left{from{opacity:1}to{transform:translate3d(-100%,0,0) skewX(-30deg);opacity:0}}',
  rotateIn: '@keyframes rbx-ac-rotate-in{from{transform:rotate3d(0,0,1,-200deg);opacity:0}to{transform:translate3d(0,0,0);opacity:1}}',
  rotateInDownLeft: '@keyframes rbx-ac-rotate-in-down-left{from{transform:rotate3d(0,0,1,-45deg);opacity:0}to{transform:translate3d(0,0,0);opacity:1}}',
  rotateInDownRight: '@keyframes rbx-ac-rotate-in-down-right{from{transform:rotate3d(0,0,1,45deg);opacity:0}to{transform:translate3d(0,0,0);opacity:1}}',
  rotateInUpLeft: '@keyframes rbx-ac-rotate-in-up-left{from{transform:rotate3d(0,0,1,45deg);opacity:0}to{transform:translate3d(0,0,0);opacity:1}}',
  rotateInUpRight: '@keyframes rbx-ac-rotate-in-up-right{from{transform:rotate3d(0,0,1,-90deg);opacity:0}to{transform:translate3d(0,0,0);opacity:1}}',
  rotateOut: '@keyframes rbx-ac-rotate-out{from{opacity:1}to{transform:rotate3d(0,0,1,200deg);opacity:0}}',
  rotateOutDownLeft: '@keyframes rbx-ac-rotate-out-down-left{from{opacity:1}to{transform:rotate3d(0,0,1,45deg);opacity:0}}',
  rotateOutDownRight: '@keyframes rbx-ac-rotate-out-down-right{from{opacity:1}to{transform:rotate3d(0,0,1,-45deg);opacity:0}}',
  rotateOutUpLeft: '@keyframes rbx-ac-rotate-out-up-left{from{opacity:1}to{transform:rotate3d(0,0,1,-45deg);opacity:0}}',
  rotateOutUpRight: '@keyframes rbx-ac-rotate-out-up-right{from{opacity:1}to{transform:rotate3d(0,0,1,90deg);opacity:0}}',
  hinge: '@keyframes rbx-ac-hinge{0%{animation-timing-function:ease-in-out}20%,60%{transform:rotate3d(0,0,1,80deg);animation-timing-function:ease-in-out}40%,80%{transform:rotate3d(0,0,1,60deg);animation-timing-function:ease-in-out;opacity:1}to{transform:translate3d(0,calc(700px * var(--u)),0);opacity:0}}',
  jackInTheBox: '@keyframes rbx-ac-jack-in-the-box{from{opacity:0;transform:scale(0.1) rotate(30deg);transform-origin:center bottom}50%{transform:rotate(-10deg)}70%{transform:rotate(3deg)}to{opacity:1;transform:scale(1)}}',
  rollIn: '@keyframes rbx-ac-roll-in{from{opacity:0;transform:translate3d(-100%,0,0) rotate3d(0,0,1,-120deg)}to{opacity:1;transform:translate3d(0,0,0)}}',
  rollOut: '@keyframes rbx-ac-roll-out{from{opacity:1}to{opacity:0;transform:translate3d(100%,0,0) rotate3d(0,0,1,120deg)}}',
  zoomIn: '@keyframes rbx-ac-zoom-in{from{opacity:0;transform:scale3d(0.3,0.3,0.3)}50%{opacity:1}}',
  zoomInDown: '@keyframes rbx-ac-zoom-in-down{from{opacity:0;transform:scale3d(0.1,0.1,0.1) translate3d(0,calc(-1000px * var(--u)),0);animation-timing-function:cubic-bezier(0.55,0.055,0.675,0.19)}60%{opacity:1;transform:scale3d(0.475,0.475,0.475) translate3d(0,calc(60px * var(--u)),0);animation-timing-function:cubic-bezier(0.175,0.885,0.32,1)}}',
  zoomInLeft: '@keyframes rbx-ac-zoom-in-left{from{opacity:0;transform:scale3d(0.1,0.1,0.1) translate3d(calc(-1000px * var(--u)),0,0);animation-timing-function:cubic-bezier(0.55,0.055,0.675,0.19)}60%{opacity:1;transform:scale3d(0.475,0.475,0.475) translate3d(calc(10px * var(--u)),0,0);animation-timing-function:cubic-bezier(0.175,0.885,0.32,1)}}',
  zoomInRight: '@keyframes rbx-ac-zoom-in-right{from{opacity:0;transform:scale3d(0.1,0.1,0.1) translate3d(calc(1000px * var(--u)),0,0);animation-timing-function:cubic-bezier(0.55,0.055,0.675,0.19)}60%{opacity:1;transform:scale3d(0.475,0.475,0.475) translate3d(calc(-10px * var(--u)),0,0);animation-timing-function:cubic-bezier(0.175,0.885,0.32,1)}}',
  zoomInUp: '@keyframes rbx-ac-zoom-in-up{from{opacity:0;transform:scale3d(0.1,0.1,0.1) translate3d(0,calc(1000px * var(--u)),0);animation-timing-function:cubic-bezier(0.55,0.055,0.675,0.19)}60%{opacity:1;transform:scale3d(0.475,0.475,0.475) translate3d(0,calc(-60px * var(--u)),0);animation-timing-function:cubic-bezier(0.175,0.885,0.32,1)}}',
  zoomOut: '@keyframes rbx-ac-zoom-out{from{opacity:1}50%{opacity:0;transform:scale3d(0.3,0.3,0.3)}to{opacity:0}}',
  zoomOutDown: '@keyframes rbx-ac-zoom-out-down{40%{opacity:1;transform:scale3d(0.475,0.475,0.475) translate3d(0,calc(-60px * var(--u)),0);animation-timing-function:cubic-bezier(0.55,0.055,0.675,0.19)}to{opacity:0;transform:scale3d(0.1,0.1,0.1) translate3d(0,calc(2000px * var(--u)),0);animation-timing-function:cubic-bezier(0.175,0.885,0.32,1)}}',
  zoomOutLeft: '@keyframes rbx-ac-zoom-out-left{40%{opacity:1;transform:scale3d(0.475,0.475,0.475) translate3d(calc(42px * var(--u)),0,0)}to{opacity:0;transform:scale(0.1) translate3d(calc(-2000px * var(--u)),0,0)}}',
  zoomOutRight: '@keyframes rbx-ac-zoom-out-right{40%{opacity:1;transform:scale3d(0.475,0.475,0.475) translate3d(calc(-42px * var(--u)),0,0)}to{opacity:0;transform:scale(0.1) translate3d(calc(2000px * var(--u)),0,0)}}',
  zoomOutUp: '@keyframes rbx-ac-zoom-out-up{40%{opacity:1;transform:scale3d(0.475,0.475,0.475) translate3d(0,calc(60px * var(--u)),0);animation-timing-function:cubic-bezier(0.55,0.055,0.675,0.19)}to{opacity:0;transform:scale3d(0.1,0.1,0.1) translate3d(0,calc(-2000px * var(--u)),0);animation-timing-function:cubic-bezier(0.175,0.885,0.32,1)}}',
  slideInDown: '@keyframes rbx-ac-slide-in-down{from{transform:translate3d(0,-100%,0);visibility:visible}to{transform:translate3d(0,0,0)}}',
  slideInLeft: '@keyframes rbx-ac-slide-in-left{from{transform:translate3d(-100%,0,0);visibility:visible}to{transform:translate3d(0,0,0)}}',
  slideInRight: '@keyframes rbx-ac-slide-in-right{from{transform:translate3d(100%,0,0);visibility:visible}to{transform:translate3d(0,0,0)}}',
  slideInUp: '@keyframes rbx-ac-slide-in-up{from{transform:translate3d(0,100%,0);visibility:visible}to{transform:translate3d(0,0,0)}}',
  slideOutDown: '@keyframes rbx-ac-slide-out-down{from{transform:translate3d(0,0,0)}to{visibility:hidden;transform:translate3d(0,100%,0)}}',
  slideOutLeft: '@keyframes rbx-ac-slide-out-left{from{transform:translate3d(0,0,0)}to{visibility:hidden;transform:translate3d(-100%,0,0)}}',
  slideOutRight: '@keyframes rbx-ac-slide-out-right{from{transform:translate3d(0,0,0)}to{visibility:hidden;transform:translate3d(100%,0,0)}}',
  slideOutUp: '@keyframes rbx-ac-slide-out-up{from{transform:translate3d(0,0,0)}to{visibility:hidden;transform:translate3d(0,-100%,0)}}',
};

/** Per-animation rules from the `.animate__<name>` classes: duration multiplier, timing-function, transform-origin, backface-visibility. */
const RULES: Record<string, AcRule> = {
  bounce: { origin: 'center bottom' },
  flash: {},
  pulse: { timing: 'ease-in-out' },
  rubberBand: {},
  shakeX: {},
  shakeY: {},
  headShake: { timing: 'ease-in-out' },
  swing: { origin: 'top center' },
  tada: {},
  wobble: {},
  jello: { origin: 'center' },
  heartBeat: { dur: 1.3, timing: 'ease-in-out' },
  backInDown: {},
  backInLeft: {},
  backInRight: {},
  backInUp: {},
  backOutDown: {},
  backOutLeft: {},
  backOutRight: {},
  backOutUp: {},
  bounceIn: { dur: 0.75 },
  bounceInDown: {},
  bounceInLeft: {},
  bounceInRight: {},
  bounceInUp: {},
  bounceOut: { dur: 0.75 },
  bounceOutDown: {},
  bounceOutLeft: {},
  bounceOutRight: {},
  bounceOutUp: {},
  fadeIn: {},
  fadeInDown: {},
  fadeInDownBig: {},
  fadeInLeft: {},
  fadeInLeftBig: {},
  fadeInRight: {},
  fadeInRightBig: {},
  fadeInUp: {},
  fadeInUpBig: {},
  fadeInTopLeft: {},
  fadeInTopRight: {},
  fadeInBottomLeft: {},
  fadeInBottomRight: {},
  fadeOut: {},
  fadeOutDown: {},
  fadeOutDownBig: {},
  fadeOutLeft: {},
  fadeOutLeftBig: {},
  fadeOutRight: {},
  fadeOutRightBig: {},
  fadeOutUp: {},
  fadeOutUpBig: {},
  fadeOutTopLeft: {},
  fadeOutTopRight: {},
  fadeOutBottomRight: {},
  fadeOutBottomLeft: {},
  flip: { backface: true },
  flipInX: { backface: true },
  flipInY: { backface: true },
  flipOutX: { dur: 0.75, backface: true },
  flipOutY: { dur: 0.75, backface: true },
  lightSpeedInRight: { timing: 'ease-out' },
  lightSpeedInLeft: { timing: 'ease-out' },
  lightSpeedOutRight: { timing: 'ease-in' },
  lightSpeedOutLeft: { timing: 'ease-in' },
  rotateIn: { origin: 'center' },
  rotateInDownLeft: { origin: 'left bottom' },
  rotateInDownRight: { origin: 'right bottom' },
  rotateInUpLeft: { origin: 'left bottom' },
  rotateInUpRight: { origin: 'right bottom' },
  rotateOut: { origin: 'center' },
  rotateOutDownLeft: { origin: 'left bottom' },
  rotateOutDownRight: { origin: 'right bottom' },
  rotateOutUpLeft: { origin: 'left bottom' },
  rotateOutUpRight: { origin: 'right bottom' },
  hinge: { dur: 2, origin: 'top left' },
  jackInTheBox: {},
  rollIn: {},
  rollOut: {},
  zoomIn: {},
  zoomInDown: {},
  zoomInLeft: {},
  zoomInRight: {},
  zoomInUp: {},
  zoomOut: {},
  zoomOutDown: { origin: 'center bottom' },
  zoomOutLeft: { origin: 'left center' },
  zoomOutRight: { origin: 'right center' },
  zoomOutUp: { origin: 'center bottom' },
  slideInDown: {},
  slideInLeft: {},
  slideInRight: {},
  slideInUp: {},
  slideOutDown: {},
  slideOutLeft: {},
  slideOutRight: {},
  slideOutUp: {},
};

/** The `source/` folders of the animate.css repository, in their order, with every animation each holds. */
export const ANIMATE_CSS_GROUPS: { group: string; names: string[] }[] = [
  { group: 'attention_seekers', names: ['bounce', 'flash', 'pulse', 'rubberBand', 'shakeX', 'shakeY', 'headShake', 'swing', 'tada', 'wobble', 'jello', 'heartBeat'] },
  { group: 'back_entrances', names: ['backInDown', 'backInLeft', 'backInRight', 'backInUp'] },
  { group: 'back_exits', names: ['backOutDown', 'backOutLeft', 'backOutRight', 'backOutUp'] },
  { group: 'bouncing_entrances', names: ['bounceIn', 'bounceInDown', 'bounceInLeft', 'bounceInRight', 'bounceInUp'] },
  { group: 'bouncing_exits', names: ['bounceOut', 'bounceOutDown', 'bounceOutLeft', 'bounceOutRight', 'bounceOutUp'] },
  { group: 'fading_entrances', names: ['fadeIn', 'fadeInDown', 'fadeInDownBig', 'fadeInLeft', 'fadeInLeftBig', 'fadeInRight', 'fadeInRightBig', 'fadeInUp', 'fadeInUpBig', 'fadeInTopLeft', 'fadeInTopRight', 'fadeInBottomLeft', 'fadeInBottomRight'] },
  { group: 'fading_exits', names: ['fadeOut', 'fadeOutDown', 'fadeOutDownBig', 'fadeOutLeft', 'fadeOutLeftBig', 'fadeOutRight', 'fadeOutRightBig', 'fadeOutUp', 'fadeOutUpBig', 'fadeOutTopLeft', 'fadeOutTopRight', 'fadeOutBottomRight', 'fadeOutBottomLeft'] },
  { group: 'flippers', names: ['flip', 'flipInX', 'flipInY', 'flipOutX', 'flipOutY'] },
  { group: 'lightspeed', names: ['lightSpeedInRight', 'lightSpeedInLeft', 'lightSpeedOutRight', 'lightSpeedOutLeft'] },
  { group: 'rotating_entrances', names: ['rotateIn', 'rotateInDownLeft', 'rotateInDownRight', 'rotateInUpLeft', 'rotateInUpRight'] },
  { group: 'rotating_exits', names: ['rotateOut', 'rotateOutDownLeft', 'rotateOutDownRight', 'rotateOutUpLeft', 'rotateOutUpRight'] },
  { group: 'specials', names: ['hinge', 'jackInTheBox', 'rollIn', 'rollOut'] },
  { group: 'zooming_entrances', names: ['zoomIn', 'zoomInDown', 'zoomInLeft', 'zoomInRight', 'zoomInUp'] },
  { group: 'zooming_exits', names: ['zoomOut', 'zoomOutDown', 'zoomOutLeft', 'zoomOutRight', 'zoomOutUp'] },
  { group: 'sliding_entrances', names: ['slideInDown', 'slideInLeft', 'slideInRight', 'slideInUp'] },
  { group: 'sliding_exits', names: ['slideOutDown', 'slideOutLeft', 'slideOutRight', 'slideOutUp'] },
];

export const ANIMATE_CSS_NAMES: string[] = ANIMATE_CSS_GROUPS.flatMap((g) => g.names);

/** How a piece plays in a clip: arrives, leaves, or draws attention to something already there. */
export type AcKind = 'entrance' | 'exit' | 'attention';

const kindOf = (name: string, group: string): AcKind =>
  group === 'attention_seekers' || name === 'flip' ? 'attention' : /Out/.test(name) || name === 'hinge' ? 'exit' : 'entrance';

/** Every animation that removes its element (the `*Out*` families, hinge and rollOut). */
export const ANIMATE_CSS_EXITS: string[] = ANIMATE_CSS_GROUPS.flatMap((g) => g.names.filter((n) => kindOf(n, g.group) === 'exit'));

const LEVEL: Record<string, BitLevel> = {
  attention_seekers: 'basic', fading_entrances: 'basic', fading_exits: 'basic', sliding_entrances: 'basic', sliding_exits: 'basic', specials: 'advanced',
};

/** What each web animation does, from its keyframes. */
const ABOUT: Record<string, string> = {
  bounce: 'Hops from its baseline three times with shrinking height (30, 15, 4 px) and a squash on each landing.',
  flash: 'Blinks off and on twice: opacity 1 → 0 → 1 → 0 → 1.',
  pulse: 'Swells to 105% and back once, ease-in-out.',
  rubberBand: 'Stretches wide, then tall, then wide again with shrinking amplitude, snapping back like an elastic band.',
  shakeX: 'Shivers left and right by 10 px nine times, then settles.',
  shakeY: 'Shivers up and down by 10 px nine times, then settles.',
  headShake: 'A quick "no": slides left and right with a small counter-rotation, decaying to rest by the halfway point.',
  swing: 'Swings from its top edge like a hanging sign: 15°, −10°, 5°, −5°, then level.',
  tada: 'Shrinks to 90%, swells to 110% while rocking ±3°, then pops back to size.',
  wobble: 'Rocks side to side, travelling up to 25% of its width while rotating ±5°, decaying to centre.',
  jello: 'Skews back and forth on both axes with shrinking amplitude, like set gelatine.',
  heartBeat: 'Two quick swells to 130% with a rest between them, 1.3 s ease-in-out — a heartbeat rhythm.',
  backInDown: 'Arrives from 1200 px above at 70% scale and 70% opacity, parks, then scales up to full size and opacity.',
  backInLeft: 'Arrives from 2000 px left at 70% scale and 70% opacity, parks, then scales up to full size and opacity.',
  backInRight: 'Arrives from 2000 px right at 70% scale and 70% opacity, parks, then scales up to full size and opacity.',
  backInUp: 'Arrives from 1200 px below at 70% scale and 70% opacity, parks, then scales up to full size and opacity.',
  backOutDown: 'Shrinks to 70% scale and opacity in place, then drops 700 px below the frame.',
  backOutLeft: 'Shrinks to 70% scale and opacity in place, then slides 2000 px left.',
  backOutRight: 'Shrinks to 70% scale and opacity in place, then slides 2000 px right.',
  backOutUp: 'Shrinks to 70% scale and opacity in place, then rises 700 px above the frame.',
  bounceIn: 'Pops in from 30% scale, overshooting to 105% and 103% before settling, 0.75 s.',
  bounceInDown: 'Drops in from 3000 px above, overshooting its resting spot twice before settling.',
  bounceInLeft: 'Slides in from 3000 px left, overshooting twice before settling.',
  bounceInRight: 'Slides in from 3000 px right, overshooting twice before settling.',
  bounceInUp: 'Rises in from 3000 px below, overshooting twice before settling.',
  bounceOut: 'Swells to 105%, shrinks to 90%, then collapses to 30% and vanishes, 0.75 s.',
  bounceOutDown: 'Nudges up, then drops 2000 px below the frame while fading.',
  bounceOutLeft: 'Nudges right, then flies 2000 px left while fading.',
  bounceOutRight: 'Nudges left, then flies 2000 px right while fading.',
  bounceOutUp: 'Nudges down, then flies 2000 px up while fading.',
  fadeIn: 'Opacity 0 → 1, nothing else.',
  fadeInDown: 'Fades in while dropping from one full height above.',
  fadeInDownBig: 'Fades in while dropping from 2000 px above.',
  fadeInLeft: 'Fades in while sliding from one full width to the left.',
  fadeInLeftBig: 'Fades in while sliding from 2000 px left.',
  fadeInRight: 'Fades in while sliding from one full width to the right.',
  fadeInRightBig: 'Fades in while sliding from 2000 px right.',
  fadeInUp: 'Fades in while rising from one full height below.',
  fadeInUpBig: 'Fades in while rising from 2000 px below.',
  fadeInTopLeft: 'Fades in while sliding diagonally from the top-left (−100%, −100%).',
  fadeInTopRight: 'Fades in while sliding diagonally from the top-right (100%, −100%).',
  fadeInBottomLeft: 'Fades in while sliding diagonally from the bottom-left (−100%, 100%).',
  fadeInBottomRight: 'Fades in while sliding diagonally from the bottom-right (100%, 100%).',
  fadeOut: 'Opacity 1 → 0, nothing else.',
  fadeOutDown: 'Fades out while dropping one full height.',
  fadeOutDownBig: 'Fades out while dropping 2000 px.',
  fadeOutLeft: 'Fades out while sliding one full width left.',
  fadeOutLeftBig: 'Fades out while sliding 2000 px left.',
  fadeOutRight: 'Fades out while sliding one full width right.',
  fadeOutRightBig: 'Fades out while sliding 2000 px right.',
  fadeOutUp: 'Fades out while rising one full height.',
  fadeOutUpBig: 'Fades out while rising 2000 px.',
  fadeOutTopLeft: 'Fades out while sliding diagonally to the top-left.',
  fadeOutTopRight: 'Fades out while sliding diagonally to the top-right.',
  fadeOutBottomRight: 'Fades out while sliding diagonally to the bottom-right.',
  fadeOutBottomLeft: 'Fades out while sliding diagonally to the bottom-left.',
  flip: 'A full 3D flip around the Y axis with 400 px perspective: pushes 150 px toward the camera, spins −360° → 0°, and lands with a scale dip.',
  flipInX: 'Flips in around the X axis from 90°, overshooting −20°, 10° and −5° with 400 px perspective, fading in.',
  flipInY: 'Flips in around the Y axis from 90°, overshooting −20°, 10° and −5° with 400 px perspective, fading in.',
  flipOutX: 'Tilts to −20° then flips away to 90° around the X axis, fading out, 0.75 s.',
  flipOutY: 'Tilts to −15° then flips away to 90° around the Y axis, fading out, 0.75 s.',
  lightSpeedInRight: 'Streaks in from the right skewed −30°, over-skews to 20° and −5°, then straightens, ease-out.',
  lightSpeedInLeft: 'Streaks in from the left skewed 30°, over-skews to −20° and 5°, then straightens, ease-out.',
  lightSpeedOutRight: 'Skews 30° and streaks off to the right while fading, ease-in.',
  lightSpeedOutLeft: 'Skews −30° and streaks off to the left while fading, ease-in.',
  rotateIn: 'Spins in from −200° around its centre while fading in.',
  rotateInDownLeft: 'Swings in from −45°, pivoting on its bottom-left corner, fading in.',
  rotateInDownRight: 'Swings in from 45°, pivoting on its bottom-right corner, fading in.',
  rotateInUpLeft: 'Swings in from 45°, pivoting on its bottom-left corner, fading in.',
  rotateInUpRight: 'Swings in from −90°, pivoting on its bottom-right corner, fading in.',
  rotateOut: 'Spins out to 200° around its centre while fading.',
  rotateOutDownLeft: 'Swings out to 45° on its bottom-left corner, fading.',
  rotateOutDownRight: 'Swings out to −45° on its bottom-right corner, fading.',
  rotateOutUpLeft: 'Swings out to −45° on its bottom-left corner, fading.',
  rotateOutUpRight: 'Swings out to 90° on its bottom-right corner, fading.',
  hinge: 'Hangs from its top-left corner, swings to 80° and 60° twice like a broken hinge, then drops 700 px and fades, 2 s.',
  jackInTheBox: 'Springs up from 10% scale rotated 30°, over-rotating to −10° and 3° around its bottom edge, fading in.',
  rollIn: 'Rolls in from the left: translates −100% while rotating −120°, fading in.',
  rollOut: 'Rolls out to the right: translates 100% while rotating 120°, fading out.',
  zoomIn: 'Scales up from 30% while fading in over the first half.',
  zoomInDown: 'Zooms in from 10% scale 1000 px above, overshooting 60 px below its spot on a snappy bezier.',
  zoomInLeft: 'Zooms in from 10% scale 1000 px left, overshooting 10 px right of its spot on a snappy bezier.',
  zoomInRight: 'Zooms in from 10% scale 1000 px right, overshooting 10 px left of its spot on a snappy bezier.',
  zoomInUp: 'Zooms in from 10% scale 1000 px below, overshooting 60 px above its spot on a snappy bezier.',
  zoomOut: 'Shrinks to 30% while fading over the first half, then disappears.',
  zoomOutDown: 'Swells to 47.5% while lifting 60 px, then shrinks to 10% and dives 2000 px below, pivoting on its bottom edge.',
  zoomOutLeft: 'Swells slightly while nudging right, then shrinks to 10% and flies 2000 px left.',
  zoomOutRight: 'Swells slightly while nudging left, then shrinks to 10% and flies 2000 px right.',
  zoomOutUp: 'Swells to 47.5% while dipping 60 px, then shrinks to 10% and flies 2000 px up, pivoting on its bottom edge.',
  slideInDown: 'Slides in from one full height above; no fade.',
  slideInLeft: 'Slides in from one full width to the left; no fade.',
  slideInRight: 'Slides in from one full width to the right; no fade.',
  slideInUp: 'Slides in from one full height below; no fade.',
  slideOutDown: 'Slides down one full height and becomes invisible; no fade.',
  slideOutLeft: 'Slides left one full width and becomes invisible; no fade.',
  slideOutRight: 'Slides right one full width and becomes invisible; no fade.',
  slideOutUp: 'Slides up one full height and becomes invisible; no fade.',
};

const USE: Record<string, string> = {
  attention_seekers: 'Drawing the eye to a card already on screen: notifications, CTAs, a stat that just changed, comedy beats.',
  back_entrances: 'Content arriving from off-frame at a distance: chapter cards, product cards, "meanwhile" panels.',
  back_exits: 'Sending a card back where it came from before the next one arrives.',
  bouncing_entrances: 'Energetic, playful titles; gaming and kids content; hype hooks.',
  bouncing_exits: 'Playful exits that match a bounce entrance.',
  fading_entrances: 'The default civilised entrance: lower-thirds, captions, quotes, any copy over footage.',
  fading_exits: 'Quiet exits; pair with the matching fade-in.',
  flippers: 'Card flips, answer reveals, before/after beats, 3D idents.',
  lightspeed: 'Speed, sport, tech, transitions that need momentum.',
  rotating_entrances: 'Stickers, stamps, badges and playful idents.',
  rotating_exits: 'Matching exits for rotating entrances.',
  specials: 'Comedy fails ("and it\'s gone"), surprise pop-ups, coins and wheels rolling through.',
  zooming_entrances: 'Emphasis on a keyword or number; pop-ups; impact titles.',
  zooming_exits: 'Punchy exits for impact cards.',
  sliding_entrances: 'Panels and lower-thirds pushing in from an edge; UI-like motion.',
  sliding_exits: 'Panels leaving by the edge they came from.',
};

const VIDEO: Record<AcKind, (name: string, dur: number) => string> = {
  entrance: (name, dur) => `The card or hero text plays the real ${name} keyframes as a paused entrance from 0.1 s over ${dur} s (scaled by --u), then holds; \`exit\` adds any Animate.css exit over the clip's last moments.`,
  exit: (name, dur) => `The copy fades on in 0.35 s and holds, then the real ${name} keyframes play over the final ${dur} s so the exit ends exactly with the clip (or the layer's \`until\`).`,
  attention: (name, dur) => `The copy fades on in 0.3 s, then the real ${name} keyframes play from 0.45 s (${dur} s each, \`repeat\` times), scrubbed frame-exactly; \`exit\` adds an Animate.css exit.`,
};

// ── helpers ──────────────────────────────────────────────────────────────────

/** `bounceInLeft` → `bounce-in-left` (the suffix of the bit id and of the `rbx-ac-*` keyframes). */
export const animateCssId = (name: string): string => name.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();

/** `bounceInLeft` → `Bounce In Left`. */
const title = (name: string): string => name.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/^./, (c) => c.toUpperCase());

/** Every non-zero px length in a CSS string scaled by `--u`, so 1920-wide designs travel the same on any canvas. */
export const scalePx = (css: string): string => css.replace(/(-?\d*\.?\d+)px/g, (m, n: string) => (Number(n) === 0 ? m : `calc(${n}px * var(--u))`));

const ruleOf = (name: string): AcRule => RULES[name] ?? {};

/** The library's own duration for an animation, in seconds (1 s unless its class says otherwise). */
export const animateCssDuration = (name: string): number => ruleOf(name).dur ?? 1;

const known = (name: string | undefined, fallback: string): string => (name && name in ANIMATE_CSS_KEYFRAMES ? name : fallback);

/** `.rbx .ac-<kebab>{…}` carrying the animation's name, default duration, timing, origin and backface rule, plus its keyframes. */
const ruleCss = (name: string): string => {
  const k = animateCssId(name);
  const r = ruleOf(name);
  return `${ANIMATE_CSS_KEYFRAMES[name]}.rbx .ac-${k}{animation-name:rbx-ac-${k};animation-duration:${animateCssDuration(name)}s;animation-timing-function:${r.timing ?? 'ease'}${r.origin ? `;transform-origin:${r.origin}` : ''}${r.backface ? ';backface-visibility:visible' : ''}}`;
};

/** Shared rules: the exit wrapper (paused, both-filled, timed by `--exit` inline) and a shrink-wrapping stage. */
const AC_CSS = '.rbx .acx{animation-fill-mode:both;animation-play-state:paused}';

/**
 * One Animate.css animation as an entrance for an element that carries class `a`:
 * add `cls` to it, put `css` in the graphic's stylesheet and `style` in its style attribute.
 * Unknown names fall back to fadeIn. `delay` is the `--d` offset in seconds; `duration` overrides the library default.
 */
export function animateCssEntrance(name: string, opts: { duration?: number; delay?: number } = {}): { cls: string; css: string; style: string } {
  const n = known(name, 'fadeIn');
  const dur = opts.duration && opts.duration > 0 ? `;animation-duration:${opts.duration.toFixed(2)}s` : '';
  return { cls: `ac-${animateCssId(n)}`, css: ruleCss(n), style: `${d(opts.delay ?? 0)}${dur}` };
}

/**
 * One Animate.css exit for a wrapper that does NOT carry `a`: the animation ends with the clip (or the layer's
 * `until`) through the `--exit` clock, exactly like the stock `.x` fade. Unknown names fall back to fadeOut.
 */
export function animateCssExit(name: string, opts: { duration?: number } = {}): { cls: string; css: string; style: string } {
  const n = known(name, 'fadeOut');
  const dur = (opts.duration && opts.duration > 0 ? opts.duration : animateCssDuration(n)).toFixed(2);
  return { cls: `acx ac-${animateCssId(n)}`, css: AC_CSS + ruleCss(n), style: `animation-duration:${dur}s;animation-delay:calc(var(--exit) + .3s - ${dur}s)` };
}

// ── the bits ─────────────────────────────────────────────────────────────────

export const P_MODE: BitProp = { name: 'mode', type: 'enum', values: ['card', 'text'], default: 'card', about: 'Glass card (kicker / heading / subtitle) or bare hero text.' };
export const P_DURATION: BitProp = { name: 'duration', type: 'number', about: 'Seconds the animation itself runs. Defaults to the library timing (1 s; bounceIn, bounceOut, flipOut .75 s; heartBeat 1.3 s; hinge 2 s).' };
const P_EXIT: BitProp = { name: 'exit', type: 'enum', values: ANIMATE_CSS_EXITS, about: 'An Animate.css exit (fadeOut, zoomOutDown, hinge …) played over the clip\'s last moments; ends with the clip or the layer\'s `until`.' };
const P_REPEAT: BitProp = { name: 'repeat', type: 'number', default: 1, about: 'Times the animation plays back to back (1–5).' };

/** The content the library pieces wrap: the shared glass card, or bare hero text when `mode` is `text`. */
export const libraryCopy = (p: BitProps, ctx: BitContext): string => {
  if (S(p, 'mode', 'card') !== 'text') return card(p, ctx);
  const sub = S(p, 'subtitle') || ctx.subtitle;
  const k = S(p, 'kicker');
  return `<div class="col" style="align-items:center;text-align:center;max-width:${px(1300)}">${k ? `<div class="kicker" style="margin-bottom:${px(14)}">${esc(k)}</div>` : ''}<div class="hero">${esc(textOf(p, ctx))}</div>${sub ? `<div class="small" style="margin-top:${px(18)}">${esc(sub)}</div>` : ''}</div>`;
};

/** The exit an entrance or attention seeker asked for, if it names a real Animate.css exit. */
const exitProp = (p: BitProps): string => {
  const e = S(p, 'exit');
  return ANIMATE_CSS_EXITS.includes(e) ? e : '';
};

/** The choreography every bit shares: an outer wrapper that leaves (Animate.css exit, or the stock `.x`), an inner `.a` that arrives. */
function play(name: string, kind: AcKind, p: BitProps, ctx: BitContext): BitOutput {
  const dur = clampN(N(p, 'duration', animateCssDuration(name)), 0.2, 8);
  const inner = libraryCopy(p, ctx);
  const css: string[] = [];
  let body: string;
  if (kind === 'entrance') {
    const enter = animateCssEntrance(name, { duration: dur, delay: 0.1 });
    css.push(enter.css);
    body = `<div class="a ${enter.cls}" style="${enter.style}">${inner}</div>`;
  } else if (kind === 'attention') {
    const seek = animateCssEntrance(name, { duration: dur, delay: 0.45 });
    css.push(seek.css);
    body = `<div class="a fade" style="${d(0.05)};animation-duration:.3s"><div class="a ${seek.cls}" style="${seek.style};animation-iteration-count:${Math.round(clampN(N(p, 'repeat', 1), 1, 5))}">${inner}</div></div>`;
  } else {
    body = `<div class="a fade" style="${d(0.05)};animation-duration:.35s">${inner}</div>`;
  }
  const exitName = kind === 'exit' ? name : exitProp(p);
  if (exitName) {
    const exit = animateCssExit(exitName, kind === 'exit' ? { duration: dur } : {});
    css.push(exit.css);
    return { html: `<div class="${exit.cls}" style="${accentStyle(p)}${exit.style}">${body}</div>`, css: css.join('') };
  }
  return { html: `<div class="x" style="${accentStyle(p)}">${body}</div>`, css: css.join('') };
}

/** One bit per Animate.css animation, in the repository's group order. */
export const ANIMATE_CSS_BITS: Bit[] = ANIMATE_CSS_GROUPS.flatMap(({ group, names }) => names.map((name) => {
  const kind = kindOf(name, group);
  const dur = animateCssDuration(name);
  const pairedExit = kind === 'entrance' ? name.replace('In', 'Out') : '';
  return bit({
    id: `ac-${animateCssId(name)}`, name: title(name), category: 'animation', level: LEVEL[group] ?? 'intermediate', source: 'animate-css',
    about: ABOUT[name] ?? `The ${name} animation from Animate.css.`,
    video: VIDEO[kind](name, dur),
    use: USE[group] ?? 'Attention and transitions.',
    props: [...CARD_PROPS, P_MODE, P_DURATION, ...(kind === 'attention' ? [P_REPEAT] : []), ...(kind === 'exit' ? [] : [P_EXIT])],
    example: { text: title(name), kicker: 'ANIMATE.CSS', ...(pairedExit && ANIMATE_CSS_EXITS.includes(pairedExit) ? { exit: pairedExit } : {}) },
    seconds: name === 'hinge' ? 4 : 3.5,
    tags: ['animate.css', group.replace(/_/g, '-'), kind],
    build: (p, ctx) => play(name, kind, p, ctx),
  });
}));

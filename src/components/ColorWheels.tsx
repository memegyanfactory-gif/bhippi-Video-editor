import { wheelRGB } from '../lib/colorGrade';
type Params = Record<string, number | boolean | string>;
export function ColorWheels({params,onChange,onCommit}:{params:Params;onChange:(key:string,value:number,commit:boolean)=>void;onCommit:()=>void}) {
  return <div className="color-wheels">{['shadow','midtone','highlight'].map(band=>{
    const hue=Number(params[band+'Hue']||0), amount=Number(params[band+'Amount']||0);
    const color=wheelRGB(hue).map(v=>Math.round((v+0.5)*255));
    return <div key={band}><strong>{band==='shadow'?'Shadows':band==='midtone'?'Midtones':'Highlights'}</strong>
      <div role="group" aria-label={band+' color wheel'} className="color-wheel" onPointerDown={e=>{e.currentTarget.setPointerCapture(e.pointerId); const rect=e.currentTarget.getBoundingClientRect(); const x=(e.clientX-rect.left)/rect.width*2-1,y=(e.clientY-rect.top)/rect.height*2-1;onChange(band+'Hue',(Math.atan2(y,x)*180/Math.PI+360)%360,false);onChange(band+'Amount',Math.min(100,Math.hypot(x,y)*100),false);}} onPointerMove={e=>{if(!e.currentTarget.hasPointerCapture(e.pointerId))return;const rect=e.currentTarget.getBoundingClientRect();const x=(e.clientX-rect.left)/rect.width*2-1,y=(e.clientY-rect.top)/rect.height*2-1;onChange(band+'Hue',(Math.atan2(y,x)*180/Math.PI+360)%360,false);onChange(band+'Amount',Math.min(100,Math.hypot(x,y)*100),false);}} onPointerUp={onCommit} onLostPointerCapture={onCommit}>
        <span style={{left:(50+Math.cos(hue*Math.PI/180)*amount/2)+'%',top:(50+Math.sin(hue*Math.PI/180)*amount/2)+'%',background:'rgb('+color.join(',')+')'}} />
      </div>
      <label>Hue<input aria-label={band+' hue'} type="range" min="0" max="360" value={hue} onChange={e=>onChange(band+'Hue',Number(e.target.value),true)} /></label>
      <label>Amount<input aria-label={band+' amount'} type="range" min="0" max="100" value={amount} onChange={e=>onChange(band+'Amount',Number(e.target.value),true)} /></label>
      <label>Luminance<input aria-label={band+' luminance'} type="range" min="-100" max="100" value={Number(params[band+'Luma']||0)} onChange={e=>onChange(band+'Luma',Number(e.target.value),true)} /></label>
    </div>;
  })}</div>;
}

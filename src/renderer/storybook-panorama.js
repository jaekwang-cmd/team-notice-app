// Painted companions for the nine journal worlds. The caller owns the single
// animation clock, visibility/reduced-motion policy and the canvas DPR transform.
(() => {
  'use strict';
  const TAU = Math.PI * 2;
  const modes = { secretForest:'forest', starObservatory:'stars', sunsetLetter:'sea', winterCabin:'snow', nightStudy:'study', cherryGarden:'blossom', lavenderField:'lavender', rainyCafe:'cafe' };
  const random = n => { const x = Math.sin(n * 78.233 + 19.27) * 43758.5453; return x - Math.floor(x); };
  function oval(c,x,y,rx,ry,color,angle=0) { c.beginPath(); c.ellipse(x,y,rx,ry,angle,0,TAU); c.fillStyle=color; c.fill(); }
  function path(c,points,color,width=1) { c.beginPath(); points.forEach((p,i)=>i?c.lineTo(...p):c.moveTo(...p)); c.strokeStyle=color; c.lineWidth=width; c.lineCap='round'; c.stroke(); }
  function shape(c,color,paint) { c.beginPath(); paint(c); c.fillStyle=color; c.fill(); }
  function box(c,x,y,w,h,color,r=2) { c.beginPath(); c.roundRect(x,y,w,h,r); c.fillStyle=color; c.fill(); }
  function glow(c,x,y,r,color) { const g=c.createRadialGradient(x,y,0,x,y,r); g.addColorStop(0,color); g.addColorStop(1,'transparent'); c.fillStyle=g; c.fillRect(x-r,y-r,2*r,2*r); }
  function leaf(c,x,y,s,color,angle=0) { c.save(); c.translate(x,y); c.rotate(angle); shape(c,color,p=>{p.moveTo(-s,0);p.quadraticCurveTo(0,-s*.8,s,0);p.quadraticCurveTo(0,s*.8,-s,0)}); path(c,[[-s*.8,0],[s*.7,0]],'#f6edc552',.55); c.restore(); }
  function petalFlower(c,x,y,s,color) { for(let i=0;i<5;i++){const a=i*TAU/5;oval(c,x+Math.cos(a)*s*.48,y+Math.sin(a)*s*.48,s*.49,s*.32,color,a)}oval(c,x,y,s*.2,s*.2,'#dbb271'); }
  function grass(c,x,y,h,color,t=0) { for(let i=0;i<5;i++){const lean=(i-2)*h*.14+Math.sin(t*.65+i)*h*.055;c.beginPath();c.moveTo(x+(i-2)*1.6,y);c.quadraticCurveTo(x+lean*.4,y-h*.57,x+lean,y-h*(.6+random(i+7)*.4));c.strokeStyle=color;c.lineWidth=.7;c.stroke()} }
  function fern(c,x,y,h,color,t) { c.save();c.translate(x,y);c.rotate(Math.sin(t*.5)*.025);path(c,[[0,0],[-h*.03,-h*.5],[h*.12,-h]],color,1);for(let i=1;i<8;i++){const yy=-h*i/9,spread=h*.24*Math.sin(i/9*Math.PI);leaf(c,-spread*.5,yy,spread*.63,color,.45);leaf(c,spread*.5,yy-1,spread*.63,color,-.5)}c.restore(); }
  function branch(c,x,y,length,color,t,flower=false,snow=false) {
    c.save();c.translate(x,y);c.rotate(Math.sin(t*.38)*.012);
    c.beginPath();c.moveTo(0,0);c.bezierCurveTo(length*.27,length*.04,length*.53,length*.34,length,length*.16);c.strokeStyle=snow?'#938b7c':'#978069';c.lineWidth=2.1;c.lineCap='round';c.stroke();
    for(let i=0;i<11;i++){const u=(i+1)/12,px=length*u,py=length*(.13*Math.sin(u*Math.PI)+u*.04),dy=(i%2?1:-1)*length*(.08+random(i)*.03);path(c,[[px,py],[px+length*.04,py+dy]],'#9a8670',.8);if(flower){petalFlower(c,px+length*.04,py+dy,length*.026,['#f3c3ce','#f9d8de','#fff0e7'][i%3]);if(i%2)petalFlower(c,px,py+dy*.7,length*.021,'#e9a9bb')}else{leaf(c,px+length*.045,py+dy,length*.04,color,i%2?.5:-.5);if(snow)oval(c,px+length*.045,py+dy-2,length*.036,1.8,'#f9faf0',-.15)}}c.restore();
  }
  function book(c,x,y,w,color,angle=0) { c.save();c.translate(x,y);c.rotate(angle);box(c,0,0,w,7,color,1.5);box(c,3,1.7,w-5,3.8,'#f0e4ca',.7);path(c,[[3,3.1],[w-3,3.1]],'#cdbb9d',.45);c.restore(); }
  function openBook(c,x,y,s=1) { c.save();c.translate(x,y);c.scale(s,s);shape(c,'#b99870',p=>{p.moveTo(-25,2);p.lineTo(-21,-14);p.quadraticCurveTo(-8,-15,0,-9);p.quadraticCurveTo(12,-16,23,-13);p.lineTo(28,3);p.quadraticCurveTo(13,0,0,5);p.closePath()});shape(c,'#f9edd4',p=>{p.moveTo(-23,0);p.lineTo(-20,-13);p.quadraticCurveTo(-8,-13,0,-8);p.lineTo(0,3);p.quadraticCurveTo(-12,-2,-23,0)});shape(c,'#fff6e3',p=>{p.moveTo(0,3);p.lineTo(0,-8);p.quadraticCurveTo(10,-14,22,-12);p.lineTo(26,1);p.quadraticCurveTo(11,-2,0,3)});for(let i=0;i<3;i++){path(c,[[4,-5+i*2.8],[18,-8+i*2.8]],'#bca98a80',.55);path(c,[[-17,-8+i*2.8],[-4,-5+i*2.8]],'#bca98a80',.55)}c.restore(); }
  function pot(c,x,y,s,color,foliage,t) { c.save();c.translate(x,y);c.scale(s,s);shape(c,color,p=>{p.moveTo(-9,-14);p.lineTo(9,-14);p.lineTo(7,0);p.quadraticCurveTo(0,3,-7,0);p.closePath()});oval(c,0,-14,9,2.1,'#d1b393');for(let i=0;i<5;i++){const a=-2.8+i*.58,xx=Math.cos(a)*17,yy=-14+Math.sin(a)*25;path(c,[[0,-14],[xx+Math.sin(t*.6+i)*1.5,yy]],foliage,.8);leaf(c,xx+Math.sin(t*.6+i)*1.5,yy,6.5,foliage,a)}c.restore(); }
  function eye(c,x,y,closed=false) { if(closed){c.beginPath();c.moveTo(x-1.5,y);c.quadraticCurveTo(x,y+1.6,x+1.7,y);c.strokeStyle='#584a3d';c.lineWidth=.75;c.stroke()}else{oval(c,x,y,.85,1,'#493f34');oval(c,x+.2,y-.3,.22,.27,'#fff7e0')} }
  function squirrel(c,x,y,s,t) {
    c.save();c.translate(x,y);c.scale(s,s);const breathe=Math.sin(t*1.4)*.25;
    oval(c,-1,1,14,2.1,'#655e4430');c.save();c.translate(-9,-11);c.rotate(Math.sin(t*.7)*.08);
    shape(c,'#a26d44',p=>{p.moveTo(5,8);p.bezierCurveTo(-24,11,-24,-18,-9,-23);p.bezierCurveTo(4,-27,8,-7,-4,-6);p.bezierCurveTo(-13,-7,-8,5,5,8)});
    c.beginPath();c.moveTo(-2,5);c.bezierCurveTo(-14,0,-18,-15,-9,-19);c.strokeStyle='#d0a36c';c.lineWidth=2;c.stroke();c.restore();
    oval(c,-1,-9+breathe,7,10,'#b47d4f',-.2);oval(c,3,-8+breathe,3.9,6.8,'#e8cba0',-.18);
    oval(c,5,-21+breathe,6.5,6,'#bb8657',-.1);shape(c,'#ac7447',p=>{p.moveTo(0,-23);p.lineTo(0,-31);p.lineTo(5,-25);p.closePath()});oval(c,2,-26,1.1,2.2,'#d5aa7f',-.25);
    oval(c,10,-20,3,2,'#e4c195');oval(c,12,-20,.9,.75,'#69503b');eye(c,7,-22);oval(c,5,-13,2.4,2,'#bb8759',-.5);oval(c,7,-12,1.9,2.3,'#97784b');oval(c,7,-13.3,2,1,'#745d3e');oval(c,-2,0,5,1.7,'#a56e44');oval(c,5,0,3.8,1.5,'#ae784c');c.restore();
  }
  function deer(c,x,y,s,t) {
    c.save();c.translate(x,y);c.scale(s,s);const breath=Math.sin(t*.85)*.28;
    oval(c,0,0,20,2,'#54705a29');for(const xx of [-10,-5,10,14]){path(c,[[xx,-11],[xx+(xx<0?-1:1),-2],[xx+(xx<0?-2:2),0]],'#a98a65',2);path(c,[[xx-1,-1],[xx+2,-1]],'#70624b',1.6)}
    oval(c,0,-15+breath,17,8.3,'#bc9b71',-.05);oval(c,8,-13+breath,6,4,'#e3d1aa');
    shape(c,'#b9966b',p=>{p.moveTo(10,-18);p.quadraticCurveTo(11,-32,15,-35);p.lineTo(22,-29);p.lineTo(18,-14);p.closePath()});
    c.save();c.translate(19,-32+breath);c.rotate(Math.sin(t*.45)*.035);oval(c,1,0,6.5,4.5,'#c7a97e',.2);oval(c,6,2,4,2.5,'#dfc7a3',.2);oval(c,9,2,.9,1,'#695944');leaf(c,-1,-6,5.8,'#af906b',-1.15);leaf(c,5,-6,4.8,'#c4a67b',-.9);leaf(c,-1,-6,3.1,'#e7d0b1',-1.15);eye(c,3,-1);c.restore();
    for(const [dx,dy] of [[-10,-18],[-4,-19],[1,-15],[-7,-13]])oval(c,dx,dy,1.3,1,'#e9d7b4');
    c.save();c.translate(-16,-16);c.rotate(Math.sin(t*.65)*.08);leaf(c,-2,-2,4.5,'#dfd4b5',-.4);c.restore();c.restore();
  }
  function rabbit(c,x,y,s,t) {
    c.save();c.translate(x,y);c.scale(s,s);oval(c,0,1,14,2,'#9b8d6b26');oval(c,-1,-9,10,8+Math.sin(t*1.1)*.2,'#f1e4cf',-.12);oval(c,-9,-6,4,4,'#fff4df');
    oval(c,7,-17,6.4,6.1,'#f8ecda');c.save();c.translate(5,-20);c.rotate(Math.sin(t*.7)*.035);oval(c,-1,-8,2.7,9,'#f1e1ce',-.18);oval(c,-1,-8,1.1,6.8,'#dfb7b6',-.18);oval(c,4,-8,2.5,9,'#f7e9d4',.14);oval(c,4,-8,1,6.5,'#e7c1be',.14);c.restore();
    eye(c,9,-18);oval(c,12,-15,.9,.7,'#b79889');path(c,[[12,-13],[15,-13]],'#c8b39f',.45);oval(c,6,0,6,1.9,'#e6d5bd');oval(c,-4,0,4.9,1.8,'#e9dac3');c.restore();
  }
  function fox(c,x,y,s,t) {
    c.save();c.translate(x,y);c.scale(s,s);oval(c,0,1,19,2,'#86958a26');
    oval(c,-1,-8,15,8+Math.sin(t*.9)*.22,'#c88350',-.12);c.save();c.translate(-5,-4);c.rotate(Math.sin(t*.6)*.028);
    shape(c,'#d59059',p=>{p.moveTo(-9,-9);p.bezierCurveTo(-25,-8,-19,6,5,2);p.quadraticCurveTo(12,0,6,-3);p.quadraticCurveTo(-9,1,-9,-9)});shape(c,'#f5e5c6',p=>{p.moveTo(1,-2);p.quadraticCurveTo(12,-4,9,0);p.quadraticCurveTo(6,3,-2,2);p.lineTo(1,-2)});c.restore();
    c.save();c.translate(9,-12);shape(c,'#bc784b',p=>{p.moveTo(-5,-2);p.lineTo(-4,-14);p.lineTo(2,-7);p.lineTo(6,-13);p.lineTo(7,-2);p.closePath()});shape(c,'#e1a46b',p=>{p.moveTo(-7,-6);p.quadraticCurveTo(0,-9,8,-4);p.lineTo(10,3);p.lineTo(2,8);p.lineTo(-6,2);p.closePath()});shape(c,'#f8e9ce',p=>{p.moveTo(-6,-1);p.lineTo(2,3);p.lineTo(8,-1);p.lineTo(9,3);p.lineTo(2,8);p.closePath()});eye(c,-1,-1,Math.sin(t*.25)>.7);eye(c,6,-1,Math.sin(t*.25)>.7);oval(c,3,4,1,1,'#6c5742');c.restore();c.restore();
  }
  function cat(c,x,y,s,t) {
    c.save();c.translate(x,y);c.scale(s,s);oval(c,0,1,19,2.5,'#775f422b');oval(c,-2,-8,15,8.3+Math.sin(t)*.25,'#aa9a7d',-.1);
    c.save();c.translate(-10,-5);c.rotate(Math.sin(t*.6)*.035);c.beginPath();c.moveTo(-3,-6);c.bezierCurveTo(-16,-2,-6,7,13,3);c.strokeStyle='#8e816a';c.lineWidth=5;c.lineCap='round';c.stroke();c.restore();
    c.save();c.translate(9,-10);shape(c,'#b5a48a',p=>{p.moveTo(-7,-1);p.lineTo(-7,-11);p.lineTo(-2,-6);p.quadraticCurveTo(1,-7,4,-5);p.lineTo(8,-10);p.lineTo(9,0);p.quadraticCurveTo(8,7,1,7);p.quadraticCurveTo(-7,6,-7,-1)});leaf(c,-5,-6,2.1,'#ceb4a2',1);leaf(c,6,-6,2,'#ceb4a2',-1);eye(c,-3,1,true);eye(c,5,1,true);oval(c,1,3,.8,.6,'#8c7364');path(c,[[-4,4],[-10,3]],'#8a806b',.45);path(c,[[6,4],[12,3]],'#8a806b',.45);for(let i=0;i<3;i++)path(c,[[i*2-1,-5],[i*2-1,-2]],'#8c8069',.8);c.restore();oval(c,8,0,4,1.7,'#c9b79b');c.restore();
  }
  function owl(c,x,y,s,t) {
    c.save();c.translate(x,y);c.scale(s,s);oval(c,0,-11,10,13+Math.sin(t*.8)*.15,'#8e8676');oval(c,0,-9,6.8,10,'#c8ba98');
    for(const xx of [-8,8])oval(c,xx,-9,3.2,8,'#716f64',xx<0?-.17:.17);
    shape(c,'#8c8370',p=>{p.moveTo(-9,-21);p.lineTo(-10,-29);p.lineTo(-3,-25);p.lineTo(4,-25);p.lineTo(10,-29);p.lineTo(9,-19);p.closePath()});
    oval(c,-4,-20,5.8,6,'#ded1ad',-.1);oval(c,4,-20,5.8,6,'#ded1ad',.1);const blink=Math.sin(t*.32)>.97;for(const xx of [-4,4]){oval(c,xx,-20,2.4,2.5,'#b39c66');if(blink)eye(c,xx,-20,true);else{oval(c,xx,-20,1.3,1.65,'#504c40');oval(c,xx+.4,-20.6,.4,.5,'#fff4d3')}}shape(c,'#b69457',p=>{p.moveTo(-1.9,-17);p.lineTo(1.9,-17);p.lineTo(0,-13.7);p.closePath()});
    for(let i=0;i<5;i++)path(c,[[-3+(i%2)*4,-11+Math.floor(i/2)*3],[-2+(i%2)*4,-9+Math.floor(i/2)*3]],'#9f947a',.8);for(const xx of [-4,4])path(c,[[xx,-1],[xx,2],[xx+2,2]],'#b59a66',1);c.restore();
  }
  function bird(c,x,y,s,t,gull=false) {
    c.save();c.translate(x,y);c.scale(s,s);
    if(gull){oval(c,0,0,6,2.8,'#f6eee0');oval(c,5,-2,2.7,2.5,'#fff7e8');shape(c,'#c6a46c',p=>{p.moveTo(7,-2);p.lineTo(11,-1);p.lineTo(7,0)});const flap=Math.sin(t*1.6)*6;
     for(const direction of [-1,1]){c.beginPath();c.moveTo(-1,-1);c.quadraticCurveTo(direction*8,-8-flap,direction*17,-5-flap*.8);c.quadraticCurveTo(direction*8,-2,-1,2);c.fillStyle=direction<0?'#c4cbc7':'#fbf4e5';c.fill();path(c,[[direction*13,-6-flap*.8],[direction*17,-5-flap*.8]],'#768b86',1.3)}eye(c,6,-2.6);
    }else{oval(c,-1,-7,8,6,'#7e9581',-.35);oval(c,4,-7,4.8,5.5,'#c79978',-.3);oval(c,6,-14,4.5,4.2,'#859683');oval(c,7,-12,3.2,2.3,'#d5b090');oval(c,-3,-7,5.8,3.3,'#647d6d',-.5);shape(c,'#6c8776',p=>{p.moveTo(-7,-8);p.lineTo(-17,-11+Math.sin(t*.8));p.lineTo(-13,-4);p.lineTo(-6,-3)});shape(c,'#aa9670',p=>{p.moveTo(9,-14);p.lineTo(13,-13);p.lineTo(9,-12)});eye(c,7,-14);path(c,[[1,-2],[1,2],[4,2]],'#8f8064',.8);path(c,[[5,-2],[5,2],[8,2]],'#8f8064',.8)}c.restore();
  }
  function butterfly(c,x,y,s,t,color='#a995c4') {
    c.save();c.translate(x+Math.sin(t*.55)*9,y+Math.cos(t*.8)*4);c.rotate(Math.sin(t*.65)*.16);const wing=.28+Math.abs(Math.sin(t*2.6))*.72;c.scale(s*wing,s);
    oval(c,-5,-2,5.8,7,color,-.4);oval(c,5,-2,5.8,7,color,.4);oval(c,-3.5,5,3.8,4.3,'#d8c7e5',-.2);oval(c,3.5,5,3.8,4.3,'#d8c7e5',.2);for(const xx of [-6,6])oval(c,xx,-3,1.8,2.3,'#f4e6dbaa');c.restore();path(c,[[x+Math.sin(t*.55)*9,y-6+Math.cos(t*.8)*4],[x+Math.sin(t*.55)*9,y+7+Math.cos(t*.8)*4]],'#847768',.9);
  }

  function ground(c,x,y,w,h,colors) { for(let i=0;i<3;i++)oval(c,x+w*.52,y+i*2,w*(.5-i*.045),h*(.42-i*.06),colors[i]); }
  function lavender(c,x,y,h,t,color='#a18db7') { const top=x+Math.sin(t*.7+x)*h*.065;path(c,[[x,y],[top,y-h]],'#91a27c',.75);leaf(c,x-2,y-h*.35,h*.18,'#a4b28e',-.55);for(let j=0;j<5;j++)oval(c,top+(j%2?1.5:-1.5),y-h+j*h*.065,1.6,2.4,color,j%2?.25:-.25); }
  function shell(c,x,y,s) { c.save();c.translate(x,y);c.scale(s,s);shape(c,'#f6ddbf',p=>{p.moveTo(0,2);p.bezierCurveTo(-13,-1,-9,-10,0,-10);p.bezierCurveTo(9,-10,13,-1,0,2)});for(let i=-2;i<=2;i++)path(c,[[0,2],[i*3.5,-7+Math.abs(i)]],'#c2a68a',.6);c.restore(); }
  function canopy(c,x,y,h,theme,t,seed=0) {
    const colors=theme==='wood'?['#bc7b50','#d1975d','#dda96c','#b96d49']:theme==='blossom'?['#efbac7','#f7d1d9','#dfa2b5','#fbe4e2']:theme==='snow'?['#c8d7ca','#e5eadf','#b3c7ba','#eff1e8']:['#8ca477','#a5b88a','#769466','#bbc798'];
    path(c,[[x,y],[x-h*.015,y-h*.58],[x+h*.025,y-h*.95]],theme==='snow'?'#a7ac94':'#a38765',h*.039);
    for(const dir of [-1,1])path(c,[[x,y-h*.43],[x+dir*h*.17,y-h*.72],[x+dir*h*.25,y-h*.89]],'#a18a68',h*.018);
    for(let i=0;i<47;i++){const a=random(i+seed)*TAU,r=Math.sqrt(random(i+seed+73))*h*.36,px=x+Math.cos(a)*r,py=y-h*.83+Math.sin(a)*r*.54+Math.sin(t*.34+i)*.45,sz=h*(.045+random(i+seed+81)*.04);oval(c,px,py,sz*1.3,sz,colors[i%4],a*.15);if(i%3===0){if(theme==='blossom')petalFlower(c,px+2,py-2,sz*.55,'#fff0e6');else leaf(c,px+1,py-1,sz*.9,colors[(i+2)%4],a)}}
  }
  function hangingGarden(c,x,y,length,h,theme,t) {
    const autumn=theme==='wood',pink=theme==='blossom',winter=theme==='snow',colors=autumn?['#c18a55','#d4a15f','#b57d50']:pink?['#b6b38a','#a6aa80','#c6bf9b']:winter?['#b9cbb9','#cbd7c4','#a5bda9']:['#8aab7a','#a6bc88','#779969'];
    c.beginPath();c.moveTo(x,y);c.bezierCurveTo(x+length*.3,y+h*.08,x+length*.61,y-h*.02,x+length,y+h*.17);c.strokeStyle=autumn?'#ae885e':'#99a275';c.lineWidth=2;c.stroke();
    for(let j=0;j<7;j++){const xx=x+length*j/7,drop=h*(.16+random(j+73)*.25),sway=Math.sin(t*.45+j)*2.2;c.beginPath();c.moveTo(xx,y);c.bezierCurveTo(xx+6+sway,y+drop*.33,xx-5+sway,y+drop*.67,xx+sway,y+drop);c.strokeStyle='#94a274';c.lineWidth=1;c.stroke();
      for(let i=0;i<5;i++){const py=y+drop*(i+1)/5,side=i%2?1:-1;leaf(c,xx+sway+side*4,py,5.5+random(i+j)*3,colors[(i+j)%3],side*.55);if(pink&&i%2===0)petalFlower(c,xx+sway+side*7,py+3,4.5,['#f4c8d3','#fff0e6'][j%2]);if(winter)oval(c,xx+sway+side*4,py-2,5,1.4,'#f4f5eb')}
    }
  }
  function windowView(c,x,y,w,h,theme,t,animal) {
    const background={wood:['#edddbb','#b8bd91'],forest:['#c7d9b1','#9fba91'],blossom:['#f7ddd9','#c7ccab'],snow:['#d5e2dc','#edf0e5'],sea:['#f9d8bc','#a8c9be'],lavender:['#ece2ed','#c7bfce'],cafe:['#d6e4d8','#aec5b0'],stars:['#68708a','#414e69'],study:['#8c836d','#c8b38c']}[theme];
    const radius=Math.min(h*.27,w*.18),trim=theme==='wood'?'#b69770':theme==='blossom'?'#c4a48f':theme==='cafe'?'#9bab8c':'#b4a68d';
    box(c,x-5,y-5,w+10,h+10,trim,[radius+5,radius+5,2,2]);c.save();c.beginPath();c.roundRect(x,y,w,h,[radius,radius,0,0]);c.clip();const g=c.createLinearGradient(x,y,x,y+h);g.addColorStop(0,background[0]);g.addColorStop(1,background[1]);c.fillStyle=g;c.fillRect(x,y,w,h);
    oval(c,x+w*.43,y+h*.92,w*.8,h*.35,theme==='snow'?'#e3e9df':'#b8c4a1');oval(c,x+w*.8,y+h*.97,w*.6,h*.18,theme==='snow'?'#f8f7ec':'#aabb94');glow(c,x+w*.7,y+h*.27,h*.75,theme==='stars'?'#cdd2de24':'#fff0c451');
    if(['wood','forest','blossom','snow','cafe'].includes(theme)){canopy(c,x+w*.15,y+h*.97,h*.97,theme,t,27);canopy(c,x+w*.85,y+h*.96,h*.87,theme,t,91);canopy(c,x+w*.36,y+h*.87,h*.55,theme,t,138)}
    if(theme==='forest'||theme==='cafe'){for(let i=0;i<5;i++)fern(c,x+w*(.07+i*.19),y+h,h*(.22+random(i)*.24),'#82a073',t+i)}
    if(theme==='lavender'){for(let i=0;i<32;i++)lavender(c,x+random(i+761)*w,y+h*(.82+random(i)*.18),h*(.17+random(i+15)*.23),t,['#a690b5','#b9a0ca','#c7b0d5'][i%3])}
    if(theme==='sea'){box(c,x,y+h*.49,w,h*.51,'#9cc3b6',0);for(let i=0;i<12;i++){const yy=y+h*(.52+i*.042);path(c,[[x+w*.04,yy],[x+w*.95,yy+Math.sin(t*.8+i)*1.1]],i%3?'#dbe7cc69':'#f8e9bd9c',.8)}oval(c,x+w*.7,y+h*.29,h*.15,h*.15,'#fff0c3')}
    if(theme==='stars'||theme==='study'){for(let i=0;i<18;i++)oval(c,x+random(i+184)*w,y+random(i+101)*h*.66,.6+random(i)*.5,.6+random(i)*.5,'#edddb696');canopy(c,x+w*.13,y+h,h*.85,'forest',t,72)}
    animal(x+w*.64,y+h*.94);c.restore();for(const u of [.32,.67])path(c,[[x+w*u,y+2],[x+w*u,y+h]],trim,2.8);path(c,[[x,y+h*.52],[x+w,y+h*.52]],trim,2);box(c,x-9,y+h,w+18,5,'#c4ac88',1);
  }
  function indoor(c,x,y,w,h,theme,t,scale) {
    const base=y+h*.9,cx=x+w*.53,frameW=Math.min(w*.7,380),frameH=h*.73,animalScale=Math.max(.96,Math.min(1.14,h/185)),frameX=x+w*.07;
    const animal=(ax,ay)=>{if(['wood','forest','blossom','snow','sea'].includes(theme))({wood:squirrel,forest:deer,blossom:rabbit,snow:fox,sea:bird}[theme])(c,ax,ay,animalScale,t,theme==='sea')};
    windowView(c,frameX,y+h*.045,frameW,frameH,theme,t,animal);
    hangingGarden(c,x-w*.18,y+h*.03,w*.31,h,theme,t);
    const desk={wood:'#c5a072',forest:'#c0b28c',blossom:'#e0c0a0',lavender:'#d2b693',cafe:'#c2a778',sea:'#dbb997',snow:'#bea584',stars:'#a99b82',study:'#b59a73'}[theme];
    shape(c,desk,p=>{p.moveTo(x-w*.11,base+3);p.lineTo(x+w*1.2,h*.79);p.lineTo(x+w*1.2,h);p.lineTo(x-w*.17,h);p.closePath()});path(c,[[x-w*.1,base+5],[x+w*1.16,h*.81]],'#efdcba5e',1.2);
    book(c,x-w*.025,base-2,w*.16,theme==='lavender'?'#b2a0bb':'#a2ad8d',-.035);book(c,x-w*.012,base-9,w*.145,theme==='blossom'?'#cdadb0':'#c3a47d',.015);openBook(c,x+w*.82,base-8,scale*.9);
    if(theme==='study'){book(c,cx-25*scale,base-1,50*scale,'#98785c');cat(c,cx,base-2,scale,t);glow(c,cx,base-22,65*scale,'#efc37b14')}
    else if(theme==='stars'){book(c,cx-24*scale,base,48*scale,'#89909b');owl(c,cx,base-1,scale,t);for(let i=0;i<7;i++){const px=x+w*(.32+random(i)*.35),py=y+h*(.15+random(i+12)*.34);oval(c,px,py,1,1,'#dbceaaa0')}}
    else if(theme==='cafe'){pot(c,cx-24*scale,base,scale,'#bd9a7e','#789c80',t);bird(c,cx+15*scale,base-1,scale,t);for(let i=0;i<8;i++){const px=x+w*(.38+random(i)*.26),py=y+h*.12+((random(i+15)*h*.55+t*12)%(h*.55));path(c,[[px,py],[px-1,py+5]],'#ceddd099',.7)}}
    else if(theme==='lavender'){pot(c,cx,base,scale,'#b6acae','#91a184',t);for(let i=0;i<9;i++)lavender(c,cx+(i-4)*2,base-14*scale,(22+random(i)*12)*scale,t,['#9a85b0','#c1abd0','#af98c0'][i%3]);butterfly(c,cx+38*scale,base-39*scale,scale*.8,t)}
    if(!['lavender','cafe'].includes(theme))pot(c,x+w*.82,base,scale*.64,theme==='blossom'?'#cba6a5':'#c3a487',theme==='forest'?'#6f956e':'#98a47e',t);
  }

  function draw(ctx,width,height,theme,scene,time) {
    if(!ctx||!Number.isFinite(width)||!Number.isFinite(height)||width<=0||height<=0)return;
    const raw=typeof theme==='string'?theme:theme?.mode,mode=modes[raw]||raw,t=Number.isFinite(time)?time:0;
    ctx.clearRect(0,0,width,height);
    if(!['wood','forest','blossom','lavender','cafe','sea','snow','study','stars'].includes(mode))return;
    const c=ctx,x=width*.31,w=width*.43,h=height,y=0,b=h*.88,s=Math.max(.68,Math.min(1.02,h/185)),cx=x+w*.54;
    c.save();c.beginPath();c.rect(width*.235,0,width*.54,height);c.clip();
    if(Number(scene)===2){indoor(c,x,y,w,h,mode,t,s);c.restore();return}
    if(['wood','forest','blossom','snow','cafe'].includes(mode)){
      hangingGarden(c,x-w*.14,h*.015,w*.43,h,mode,t);
      canopy(c,x+w*.14,b+6,h*.78,mode,t,51);
      canopy(c,x+w*.85,b+8,h*.61,mode,t,123);
    }
    if(mode==='wood'){
      ground(c,x+w*.12,b+8,w*.78,h*.2,['#c7ba8e45','#b7af7f38','#b8a17a20']);branch(c,x+w*.02,h*.14,w*.53,'#c18a54',t);branch(c,x+w*.49,h*.12,w*.34,'#d2a063',t+1);
      box(c,cx-15*s,b-9*s,30*s,19*s,'#b19471',[4,4,2,2]);oval(c,cx,b-9*s,15*s,3*s,'#d1b28c');oval(c,cx,b-9*s,9*s,1.7*s,'#bc9b72');path(c,[[cx-9*s,b-5*s],[cx-9*s,b+7*s]],'#967e5e',.8);squirrel(c,cx+3*s,b-9*s,s,t);
      for(let i=0;i<18;i++){const px=x+w*(.18+random(i+22)*.63),py=b+random(i+10)*10;leaf(c,px,py,3+random(i)*2,['#c68b52','#b77e4e','#d2a665'][i%3],random(i)*TAU)}for(const u of [.18,.39,.72,.86])grass(c,x+w*u,b+8,15*s,'#a5a177',t);
    }else if(mode==='forest'){
      ground(c,x+w*.1,b+6,w*.83,h*.27,['#a9be8a4f','#98b47e3b','#8ea87524']);
      shape(c,'#a7cbbb80',p=>{p.moveTo(x+w*.56,h*.51);p.bezierCurveTo(x+w*.23,h*.72,x+w*.75,h*.8,x+w*.58,h);p.lineTo(x+w*.77,h);p.bezierCurveTo(x+w*.81,h*.71,x+w*.38,h*.71,x+w*.59,h*.51)});
      for(let i=0;i<6;i++){const px=x+w*(.48+random(i)*.16),py=h*(.71+i*.04)+Math.sin(t*.8+i)*.7;path(c,[[px-7,py],[px+9,py]],'#e0ebca8c',.8)}
      for(const [u,hh] of [[.15,.3],[.23,.4],[.38,.2],[.8,.31],[.87,.39]])fern(c,x+w*u,b+7,h*hh,'#83a473',t+u);deer(c,cx+15*s,b-1,s*.93,t);
      for(let i=0;i<7;i++){const px=x+w*(.2+random(i)*.57),py=b+random(i+31)*13;path(c,[[px,py],[px,py-5]],'#b6a384',1);oval(c,px,py-6,3.7,2,['#cfa587','#d7c8a1'][i%2])}
    }else if(mode==='blossom'){
      ground(c,x+w*.1,b+7,w*.8,h*.23,['#c7c69e45','#d8bca82c','#b1be8d22']);branch(c,x+w*.04,h*.17,w*.5,'#e6b4c2',t,true);branch(c,x+w*.55,h*.21,w*.3,'#e9beca',t+2,true);
      shape(c,'#e6cdb14c',p=>{p.moveTo(x+w*.54,h*.58);p.quadraticCurveTo(x+w*.41,h*.82,x+w*.25,h);p.lineTo(x+w*.61,h);p.quadraticCurveTo(x+w*.52,h*.79,x+w*.59,h*.58)});rabbit(c,cx,b,s,t);
      for(let i=0;i<13;i++){const px=x+w*(.2+random(i)*.63)+Math.sin(t*.45+i)*4,py=h*.25+(random(i+20)*h*.67+t*(3+random(i)*2))%(h*.67);oval(c,px,py,2.2,1,'#e8b4c5b3',t*.2+i)}
      for(let i=0;i<10;i++){const px=x+w*(.16+random(i+72)*.69),py=b+random(i)*12;grass(c,px,py,7*s,'#a6b28a',t);petalFlower(c,px,py-8*s,2.4,'#fff0d8')}
    }else if(mode==='lavender'){
      ground(c,x+w*.1,b+6,w*.82,h*.25,['#c6bed443','#a8b48d2b','#b6abc637']);for(let j=0;j<3;j++){
        c.beginPath();c.moveTo(x+w*.62,h*.5+j*3);c.quadraticCurveTo(x+w*(.41-j*.1),h*.67,x+w*(.16+j*.2),h);c.strokeStyle=['#b3a0c02e','#ad9ab933','#c3b0ce29'][j];c.lineWidth=9+j*5;c.stroke();
      }
      for(let i=0;i<50;i++){const px=x+w*(.04+random(i+31)*.81),py=h*(.7+random(i+37)*.27),hh=(18+random(i)*34)*s;lavender(c,px,py,hh,t,['#a591b8','#b6a0c9','#cbb7d9'][i%3])}butterfly(c,cx-2*s,h*.5,Math.max(1,s*1.15),t);butterfly(c,x+w*.78,h*.66,s*.82,t+2,'#d2b98e');
    }else if(mode==='cafe'){
      ground(c,x+w*.1,b+8,w*.84,h*.24,['#aac6a24a','#9dbb9b35','#bec9ac2c']);for(const [u,hh] of [[.17,.32],[.29,.24],[.78,.29],[.86,.36]])fern(c,x+w*u,b+7,h*hh,'#83a183',t+u);branch(c,x+w*.04,h*.19,w*.5,'#8fa98a',t);
      const by=b-4*s;path(c,[[cx,by-5*s],[cx,by+10*s]],'#a3ae96',5*s);oval(c,cx,by+10*s,13*s,2*s,'#b4bba4');oval(c,cx,by-7*s,21*s,5*s,'#a1b59e');oval(c,cx,by-8*s,17*s,3*s,'#d1dfcb');bird(c,cx+6*s,by-12*s,s,t);
      for(let i=0;i<9;i++){const px=x+w*(.27+random(i)*.52),py=h*.21+((random(i+9)*h*.7+t*15)%(h*.7));path(c,[[px,py],[px-1.4,py+7]],'#f5f7e9a3',.75)}for(let i=0;i<3;i++){const u=(t*.3+i/3)%1; c.beginPath();c.ellipse(x+w*(.33+i*.19),b+12,2+u*8,.7+u*1.7,0,0,TAU);c.strokeStyle=`rgba(228,239,216,${((1-u)*.68).toFixed(3)})`;c.lineWidth=.7;c.stroke()}
    }else if(mode==='sea'){
      shape(c,'#9fc6bb48',p=>{p.moveTo(x+w*.08,h*.77);p.bezierCurveTo(x+w*.38,h*.58,x+w*.61,h*.83,x+w*.97,h*.55);p.lineTo(x+w*.97,h);p.lineTo(x+w*.08,h);p.closePath()});
      shape(c,'#ecd0ab78',p=>{p.moveTo(x+w*.08,h);p.bezierCurveTo(x+w*.33,h*.74,x+w*.6,h*.96,x+w*.91,h*.74);p.lineTo(x+w*.97,h);p.closePath()});for(let i=0;i<4;i++){c.beginPath();c.moveTo(x+w*.17,h*(.83+i*.03));c.bezierCurveTo(x+w*.43,h*(.65+i*.03)+Math.sin(t*.6+i),x+w*.56,h*(.9+i*.02),x+w*.9,h*(.65+i*.03));c.strokeStyle=i%2?'#f8eed17a':'#e8e5c870';c.lineWidth=i===3?1.5:.7;c.stroke()}
      shell(c,x+w*.46,b+9,.73*s);shell(c,x+w*.67,b+4,.5*s);for(const u of [.22,.29,.85])grass(c,x+w*u,h*.97,h*.21,'#a9ac7e',t);bird(c,cx+Math.sin(t*.18)*w*.04,h*.47+Math.sin(t*.7)*3,s*.86,t,true);
    }else if(mode==='snow'){
      ground(c,x+w*.11,b+6,w*.81,h*.26,['#e8ede383','#eef1e5a6','#d3dfcf55']);branch(c,x+w*.02,h*.2,w*.46,'#a8b6a1',t,false,true);branch(c,x+w*.63,h*.33,w*.24,'#aab9a8',t+1,false,true);
      fox(c,cx,b,s,t);for(let i=0;i<7;i++){const px=x+w*(.69+i*.019),py=b+7+(i%2)*3;oval(c,px,py,1.4,.8,'#adbcb14a',-.3)}for(let i=0;i<16;i++){const px=x+w*(.17+random(i+11)*.66)+Math.sin(t*.4+i)*3,py=(random(i)*h+t*(4+random(i+33)*4))%h;oval(c,px,py,.8+random(i)*.7,.8+random(i)*.7,'#f8faf0bb')}
    }else if(mode==='study'){
      const dy=b+5;box(c,x+w*.22,dy,w*.62,5,'#a98c632f',2);book(c,cx-24*s,dy-7,49*s,'#9ba082',.015);book(c,cx-22*s,dy-14,44*s,'#bd9e72',-.04);cat(c,cx,dy-15,s,t);openBook(c,x+w*.78,dy-2,s*.62);
      const lx=x+w*.28;path(c,[[lx,dy],[lx,dy-41*s],[lx+10*s,dy-51*s]],'#b69d72',2.1*s);oval(c,lx,dy,13*s,2*s,'#a58d63');shape(c,'#97a084',p=>{p.moveTo(lx-9*s,dy-55*s);p.quadraticCurveTo(lx+7*s,dy-64*s,lx+21*s,dy-53*s);p.lineTo(lx+23*s,dy-45*s);p.lineTo(lx-12*s,dy-45*s);p.closePath()});path(c,[[lx-11*s,dy-45*s],[lx+23*s,dy-45*s]],'#d6bf8d',1.5);glow(c,lx+7*s,dy-31*s,43*s,'#efd09127');pot(c,x+w*.89,dy,s*.58,'#a78a64','#8a9b79',t);
    }else if(mode==='stars'){
      ground(c,x+w*.12,b+9,w*.83,h*.28,['#65728c26','#6875832c','#7787791c']);for(const u of [.19,.27,.39,.72,.84])grass(c,x+w*u,b+7,h*(.12+u*.05),'#8a9b85',t);
      const py=b-3;path(c,[[cx-33*s,py],[cx+38*s,py+2]],'#a09678',3*s);path(c,[[cx+25*s,py],[cx+31*s,py+12*s]],'#a09678',1.4*s);owl(c,cx,py-1,s,t);
      for(let i=0;i<17;i++){const px=x+w*(.12+random(i+11)*.79),py=h*(.17+random(i+93)*.47),alpha=.35+(Math.sin(t*.65+i)+1)*.18;c.globalAlpha=alpha;oval(c,px,py,1,1,'#decc9c');if(i%5===0){path(c,[[px-2.8,py],[px+2.8,py]],'#eee0b6',.65);path(c,[[px,py-2.8],[px,py+2.8]],'#eee0b6',.65)}}c.globalAlpha=1;
    }
    c.restore();
  }
  window.storybookPanorama = Object.freeze({ draw });
})();

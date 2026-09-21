// Nine illustrated local canvas worlds. No account data, network calls or business actions.
(() => {
 const root=document.getElementById('journal-world'); if(!root)return;
 const $=s=>root.querySelector(s), $$=s=>[...root.querySelectorAll(s)];
 const themes={
  forest:{eye:'CHAPTER 01 · THE SECRET GARDEN',title:'숲이 건네는 인사로,\n오늘을 열어요.',sub:'오래 기억하고 싶은 순간들을\n잎사귀처럼 한 장씩 모아두는 곳.',stamp:'고요한 숲속, 나만의 기록',side:'서두르지 않아도,\n당신의 이야기는 자라요.',flourish:'작은 일에도, 마음 한 조각',poem:'오늘도, 당신의 계절이 자라는 중'},
  stars:{eye:'CHAPTER 02 · THE STARKEEPER',title:'잠든 세상 위로,\n나의 별을 기록해요.',sub:'흩어져 있던 하루의 조각들이\n나만의 별자리가 되는 시간.',stamp:'오늘 밤, 나의 작은 우주',side:'아주 작은 빛도,\n제자리에선 별이 됩니다.',flourish:'A PAGE FULL OF STARS',poem:'오늘의 기록이 내일의 별자리가 되도록'},
  sea:{eye:'CHAPTER 03 · LETTERS TO THE SEA',title:'마음이 머무는 곳에,\n노을 한 장.',sub:'파도에 실어 보내고 싶은 마음과\n오래 간직하고 싶은 오늘의 빛.',stamp:'느린 파도와 함께 쓰는 편지',side:'조금 느려도 좋아요.\n파도는 늘 도착하니까.',flourish:'오늘을 접어, 내일에게',poem:'잔잔한 하루에도 반짝이는 장면은 있어요'},
  snow:{eye:'CHAPTER 04 · THE WINTER CABIN',title:'바깥엔 하얀 눈,\n여기엔 따뜻한 하루.',sub:'차 한 잔이 식기 전,\n오늘의 마음을 다정히 펼쳐보세요.',stamp:'겨울 숲에서 보내는 안부',side:'추운 날에도,\n마음에는 불을 켜두세요.',flourish:'온기를 오래 간직하는 법',poem:'오늘 하루도, 포근하게 덮어두어요'},
  wood:{eye:'CHAPTER 05 · AN AUTUMN AFTERNOON',title:'붉게 물든 오후를,\n한 장씩 간직해요.',sub:'나무의 결을 닮은, 오래 머물고 싶은 곳.\n바람이 놓고 간 낙엽 한 장과 함께.',stamp:'가을 햇살 아래, 천천히',side:'어떤 날은,\n느린 마음이 더 멀리 가요.',flourish:'조금씩 깊어지는 하루',poem:'천천히 쌓인 시간이 가장 따뜻해요'},
  study:{eye:'CHAPTER 06 · THE QUIET LIBRARY',title:'비 오는 밤에는,\n이야기가 깊어져요.',sub:'창밖의 빗소리를 배경 삼아,\n오늘의 마지막 문장을 적는 시간.',stamp:'불을 켜둔, 나만의 서재',side:'오늘의 마지막 페이지에,\n다정한 말을 남겨주세요.',flourish:'책갈피 사이에 남은 온기',poem:'밤이 깊어질수록, 마음은 선명해져요'},
  blossom:{eye:'CHAPTER 07 · THE BLOSSOM BOOKSHOP',title:'꽃잎이 머문 자리,\n이야기가 피어나요.',sub:'분홍빛 바람을 따라 걷다가\n우연히 만난 작은 책방처럼.',stamp:'봄바람이 넘겨주는 한 페이지',side:'오늘의 작은 마음도,\n언젠가 꽃이 될 거예요.',flourish:'꽃이 피는 속도로, 천천히',poem:'기억하고 싶은 봄을 한 장 남겨요'},
  lavender:{eye:'CHAPTER 08 · A FIELD OF QUIET',title:'보랏빛 바람 속에,\n오늘을 펼쳐요.',sub:'낮은 언덕을 따라 향기가 번지고,\n하루에도 느긋한 틈이 생겨요.',stamp:'햇살과 라벤더가 머무는 오후',side:'향기처럼 오래 남을,\n당신의 평범한 하루.',flourish:'서두르지 않는 오후의 기록',poem:'작은 여유가 하루의 색을 바꾸어요'},
  cafe:{eye:'CHAPTER 09 · THE RAIN GARDEN',title:'비가 쉬어가는 정원,\n나도 잠깐 머물러요.',sub:'촉촉해진 잎사귀와 따뜻한 차,\n창가에는 쓰고 싶은 이야기가.',stamp:'빗소리 한 잔, 마음 한 페이지',side:'조금 흐린 날에도,\n마음에는 온기가 있어요.',flourish:'비 오는 날의 다정한 쉼표',poem:'오늘의 속도로, 편안하게 머물러요'}
 };
 const reduce=matchMedia('(prefers-reduced-motion: reduce)');
 const places={
  forest:[{name:'숲의 입구'},{name:'이끼 오솔길',title:'한 걸음 더 들어오면,\n숲의 속도가 보여요.',sub:'작은 다리 아래로 흐르는 물,\n나뭇잎 사이로 천천히 옮겨가는 빛.'},{name:'숲속 책방',title:'숲을 곁에 두고,\n이야기를 펼쳐요.',sub:'창밖에는 초록의 숨결이,\n책상 위에는 당신만의 문장이.'}],
  stars:[{name:'별이 뜨는 언덕'},{name:'천문관 테라스',title:'조금 더 가까이,\n별을 만나는 자리.',sub:'별자리를 따라 시선을 옮기다 보면,\n오늘의 고민도 조금 작아져요.'},{name:'별지기의 서재',title:'달빛이 책갈피가\n되는 밤.',sub:'오래된 별 지도와 따뜻한 차,\n그 사이에 조용히 펼쳐놓은 하루.'}],
  sea:[{name:'노을 바다'},{name:'물결 닿는 해변',title:'모래 위의 발자국,\n그 옆에 남긴 마음.',sub:'가까이 다가온 파도가\n분주했던 하루를 천천히 데려가요.'},{name:'바닷가 편지방',title:'창문을 열어두고,\n오늘을 접어요.',sub:'바다를 바라보는 작은 책상,\n아직 보내지 않은 편지 한 장.'}],
  snow:[{name:'눈 덮인 숲'},{name:'오두막 앞마당',title:'문 앞에 도착하니,\n마음부터 따뜻해져요.',sub:'발끝에 내려앉는 눈송이와\n창문 너머 기다리는 노란 불빛.'},{name:'벽난로 곁',title:'바깥은 겨울,\n내 마음은 포근하게.',sub:'장작이 내어주는 작은 온기,\n하얀 풍경을 마주한 나만의 자리.'}],
  wood:[{name:'단풍 산책길'},{name:'나무 베란다',title:'낙엽이 머무는 곳에,\n나도 잠시.',sub:'붉은 잎이 느리게 돌아 내려오고,\n오후의 햇살은 나무에 스며들어요.'},{name:'가을빛 책상',title:'익숙한 나무 향,\n새로운 한 페이지.',sub:'창밖의 단풍이 살며시 흔들리면,\n마음에도 작은 여백이 생겨요.'}],
  study:[{name:'불 켜진 서재'},{name:'비 내리는 창가',title:'창 하나를 사이에 두고,\n밤과 나란히.',sub:'빗방울이 그리는 느린 선들,\n그 너머로 번지는 도시의 불빛.'},{name:'독서등 아래',title:'한 줄 더 읽고 싶은,\n그런 밤.',sub:'따뜻한 조명과 익숙한 책의 무게.\n이 자리에 오늘을 내려놓아요.'}],
  blossom:[{name:'벚꽃 책방 가는 길'},{name:'꽃그늘 테라스',title:'꽃그늘 아래 앉아,\n마음도 쉬어가요.',sub:'책 한 권을 골라 펼쳐놓으면,\n꽃잎이 살며시 곁에 내려앉아요.'},{name:'봄빛 독서 창가',title:'창문 한 칸 가득,\n봄을 들여놓아요.',sub:'책장 사이에 스며드는 햇살,\n그 빛으로 오늘을 적어요.'}],
  lavender:[{name:'라벤더 언덕'},{name:'프로방스의 작은 정원',title:'꽃향기가 이끄는 곳,\n느린 오후의 정원.',sub:'돌담 너머 불어오는 바람에,\n생각도 가벼워지는 시간.'},{name:'꽃다발 작업실',title:'향기로운 오늘을,\n한 다발 묶어두어요.',sub:'말린 꽃과 아직 빈 노트,\n가장 좋아하는 오후의 풍경.'}],
  cafe:[{name:'비 오는 정원길'},{name:'유리 온실 카페',title:'빗방울이 두드리는,\n작은 유리 정원.',sub:'싱그러운 잎사귀 사이로,\n따뜻한 불빛이 길을 밝혀요.'},{name:'찻잔 놓인 창가',title:'비 오는 창가에,\n따뜻한 쉼표 하나.',sub:'찻잔에서 피어오르는 온기와,\n종이에 가만히 남겨둔 마음.'}]
 };

 const modes={wood:'wood',nightStudy:'study',secretForest:'forest',starObservatory:'stars',sunsetLetter:'sea',winterCabin:'snow',cherryGarden:'blossom',lavenderField:'lavender',rainyCafe:'cafe'};
 const pagePlace={journal:0,today:0,calendar:1,memo:2,memos:2,ai:2,chulgo:2,ledger:2,reminder:1,compare:2,finance:2,org:1,settings:1};
 const storageKey='journal_world_preferences_v1';
 let saved={};try{saved=JSON.parse(localStorage.getItem(storageKey)||'{}')||{}}catch(_){}
 const state={theme:'wood',scene:1,followPage:saved.followPage!==false,motion:!reduce.matches&&saved.motion!==false,strength:.9,page:'calendar',collapsed:saved.collapsed===true};
 const sceneMemory=saved.scenes&&typeof saved.scenes==='object'?saved.scenes:{};
 let frame=0,lastFrame=0,visible=false,timeline=0,lastTick=0,enabled=false;
 const base=$('.world-landscape'),fx=$('.world-weather'),ctx=base.getContext('2d'),anim=fx.getContext('2d');
 const staticCanvas=document.createElement('canvas'),paper=staticCanvas.getContext('2d');
 // Decorative animals and gardens share this world's one animation clock.
 const sideLife=document.querySelector?.('.journal-side-life');
 const decorations=[
  {canvas:$('.world-panorama'),painter:()=>window.storybookPanorama},
  {canvas:document.querySelector?.('.journal-side-canvas'),painter:()=>window.storybookSidebar}
 ].filter(item=>item.canvas);
 function resizeDecorations(){
  const dpr=Math.min(devicePixelRatio||1,1.5);
  for(const item of decorations){
   const rect=item.canvas.getBoundingClientRect();item.width=rect.width;item.height=rect.height;item.dpr=dpr;
   const w=Math.round(rect.width*dpr),h=Math.round(rect.height*dpr);
   if(item.canvas.width!==w)item.canvas.width=w;if(item.canvas.height!==h)item.canvas.height=h;
   item.ctx=item.canvas.getContext('2d');
  }
 }
 function drawDecorations(time){
  for(const item of decorations){
   const painter=item.painter();if(!item.ctx||!painter||item.width<1||item.height<24)continue;
   item.ctx.save();item.ctx.setTransform(item.dpr,0,0,item.dpr,0,0);
   item.ctx.clearRect(0,0,item.width,item.height);
   painter.draw(item.ctx,item.width,item.height,state.theme,state.scene,time);
   item.ctx.restore();
  }
 }

 if(!ctx||!anim||!paper)return;
 function persist(){try{localStorage.setItem(storageKey,JSON.stringify({followPage:state.followPage,motion:state.motion,collapsed:state.collapsed,scenes:sceneMemory}))}catch(_){}}
 function noise(seed){const x=Math.sin(seed*93.71+17.34)*43758.5453;return x-Math.floor(x)}
 function ellipse(c,x,y,rx,ry,color,rot=0){c.beginPath();c.ellipse(x,y,rx,ry,rot,0,Math.PI*2);c.fillStyle=color;c.fill()}
 function poly(c,points,color){c.beginPath();points.forEach(([x,y],i)=>i?c.lineTo(x,y):c.moveTo(x,y));c.closePath();c.fillStyle=color;c.fill()}
 function line(c,points,color,width=1){c.beginPath();points.forEach(([x,y],i)=>i?c.lineTo(x,y):c.moveTo(x,y));c.strokeStyle=color;c.lineWidth=width;c.stroke()}
 function gradient(c,x,y,w,h,stops){const g=c.createLinearGradient(x,y,x+w,y+h);stops.forEach(([p,col])=>g.addColorStop(p,col));return g}
 function glow(c,x,y,r,color){const g=c.createRadialGradient(x,y,0,x,y,r);g.addColorStop(0,color);g.addColorStop(1,'transparent');c.fillStyle=g;c.fillRect(x-r,y-r,r*2,r*2)}
 function hill(c,y,col,a=25,phase=0){c.beginPath();c.moveTo(0,360);c.lineTo(0,y);for(let x=0;x<=1000;x+=10)c.lineTo(x,y+Math.sin(x/180+phase)*a+Math.sin(x/87+phase)*a/4);c.lineTo(1000,360);c.closePath();c.fillStyle=col;c.fill()}
 function pine(c,x,y,h,col,snow=false){c.save();c.translate(x,y);c.fillStyle=col;c.fillRect(-h*.017,-h*.65,h*.034,h*.65);for(let j=0;j<5;j++){let top=-h+j*h*.135,span=h*(.1+j*.043);poly(c,[[0,top],[-span,top+h*.36],[span,top+h*.36]],col);if(snow)poly(c,[[0,top],[-span*.72,top+h*.27],[-span*.1,top+h*.23],[span*.6,top+h*.29]],'#e4e9e2')}c.restore()}
 function cottage(c,x,y,scale,winter=false){c.save();c.translate(x,y);c.scale(scale,scale);ellipse(c,0,15,100,21,winter?'#b4c2be':'#4a63435c');let wall=winter?'#855f45':'#dcd6aa';c.fillStyle=wall;c.fillRect(-66,-90,132,105);poly(c,[[-86,-87],[0,-152],[88,-87]],winter?'#55483e':'#456b52');poly(c,[[-84,-87],[0,-153],[88,-87],[78,-96],[1,-144],[-66,-86]],winter?'#f1efe7':'#809661');c.fillStyle='#655143';c.fillRect(44,-154,14,41);c.fillStyle=winter?'#ece8db':'#8c9971';c.fillRect(41,-158,20,6);if(winter)poly(c,[[-85,-88],[0,-154],[88,-88],[83,-80],[61,-93],[47,-96],[31,-110],[1,-136],[-50,-96]],'#e3e8df');c.fillStyle='#514d39';c.fillRect(-14,-51,28,66);c.beginPath();c.arc(0,-49,14,Math.PI,0);c.fill();glow(c,0,-40,43,'#fcd48570');c.fillStyle='#ffdd91';c.fillRect(-9,-50,18,22);for(const wx of [-46,31]){glow(c,wx+7,-49,26,'#ffce8270');c.fillStyle='#5d543e';c.fillRect(wx-3,-65,29,31);c.fillStyle='#fbd799';c.fillRect(wx,-62,23,24);line(c,[[wx+11,-63],[wx+11,-37]],'#756548',2);line(c,[[wx,-50],[wx+23,-50]],'#756548',2)}c.fillStyle=winter?'#d8dcd2':'#8d9970';c.fillRect(-76,12,152,5);c.fillRect(-38,18,76,4);for(let j=0;j<7;j++)line(c,[[-65,-82+j*14],[-20,-82+j*14]],winter?'#62432b70':'#b9b58a60',1);c.restore()}
 function forest(c){c.fillStyle=gradient(c,0,0,0,340,[[0,'#cbdbb8'],[.45,'#b8cea3'],[1,'#657f56']]);c.fillRect(0,0,1000,340);glow(c,540,82,280,'#fff3c7c0');hill(c,157,'#99b68b',23,1);hill(c,202,'#7f9d76',30,2);for(let i=0;i<34;i++){let x=i*34+noise(i)*13;c.fillStyle='#54745c28';c.fillRect(x,-20,6+noise(i+20)*6,230);ellipse(c,x,noise(i+3)*82,30+noise(i+9)*30,70,'#6c946452')}
 c.save();c.globalAlpha=.15;poly(c,[[516,0],[556,0],[930,340],[654,340]],'#fff6cb');poly(c,[[461,0],[480,0],[650,340],[579,340]],'#fffad1');c.restore();hill(c,262,'#628358',25,1.9);
 c.beginPath();c.moveTo(713,213);c.bezierCurveTo(670,258,779,274,677,340);c.lineTo(873,340);c.bezierCurveTo(847,291,744,267,742,212);c.closePath();c.fillStyle='#b5b286';c.fill();cottage(c,751,240,.64);
 for(let i=0;i<16;i++){let x=420+noise(i+20)*620,y=251+noise(i+9)*79;ellipse(c,x,y,13+noise(i)*24,8+noise(i+2)*12,'#52774e')}
 for(const [x,y,h] of [[417,255,320],[953,268,365],[349,240,260]]){c.fillStyle='#385d4780';c.beginPath();c.moveTo(x-11,y);c.quadraticCurveTo(x+13,y-h*.55,x-2,y-h);c.lineTo(x+14,y-h);c.quadraticCurveTo(x+25,y-h*.4,x+9,y);c.fill();line(c,[[x+5,y-h*.5],[x-42,y-h*.78]],'#395c47',8)}
 for(let i=0;i<66;i++){let x=342+noise(i+70)*750,y=-30+noise(i+59)*110;ellipse(c,x,y,22+noise(i+2)*50,15+noise(i+30)*28,['#31583f','#476a47','#567a4e','#708a51'][i%4],noise(i)*.7)}
 for(let i=0;i<145;i++){const x=370+noise(i+120)*690,y=285+noise(i+7)*65;c.strokeStyle=i%3?'#3c6548':'#87a266';c.lineWidth=1.3;c.beginPath();c.moveTo(x,y);c.quadraticCurveTo(x-4,y-8,x+noise(i+90)*12-6,y-18*noise(i+3));c.stroke();if(i%9===0){ellipse(c,x,y-9,2,2,'#e8d993')}}
 for(let i=0;i<18;i++){let x=530+noise(i+200)*370,y=253+noise(i+13)*68;ellipse(c,x,y,3.2,3,'#dcd8bc');ellipse(c,x+1,y-3,6,3,['#b48c66','#bd8166','#d5c9a6'][i%3])}
 }
 function stars(c){c.fillStyle=gradient(c,0,0,0,340,[[0,'#111a2d'],[.6,'#2d3656'],[1,'#565672']]);c.fillRect(0,0,1000,340);glow(c,735,165,225,'#ae86a532');glow(c,613,60,230,'#707ca42c');for(let i=0;i<165;i++){let x=noise(i)*1000,y=noise(i+600)*295,r=noise(i+420)*1.25+.3;ellipse(c,x,y,r,r,i%4?'#d8d9ddb3':'#e7cfa7')}
 c.save();c.translate(741,146);c.strokeStyle='#b8a88045';c.lineWidth=.7;[83,117,151].forEach(r=>{c.beginPath();c.ellipse(0,0,r,r*.59,-.4,0,Math.PI*2);c.stroke()});c.beginPath();c.arc(0,0,126,-2.7,.2);c.stroke();c.restore();glow(c,790,63,57,'#f5deb53b');ellipse(c,790,63,25,25,'#efdfb8');ellipse(c,802,54,22,24,'#1f2843');
 hill(c,245,'#202c47',33,1);hill(c,284,'#172239',22,3);for(let i=0;i<15;i++)pine(c,420+i*45,330,45+noise(i)*72,'#121d31');
 c.save();c.translate(742,281);c.fillStyle='#334058';c.fillRect(-46,-81,92,102);c.beginPath();c.arc(0,-80,49,Math.PI,0);c.fillStyle='#536077';c.fill();c.strokeStyle='#aa936a';c.lineWidth=2;c.beginPath();c.arc(0,-80,49,Math.PI,0);c.stroke();for(let i=-2;i<3;i++)line(c,[[i*15,-121+Math.abs(i)*9],[i*20,-81]],'#b6a07675',1);c.fillStyle='#b3a380';c.fillRect(-53,-82,106,5);c.fillRect(-54,18,108,4);for(const x of [-25,8]){c.fillStyle='#e9cd95';c.beginPath();c.roundRect(x,-62,15,32,[7,7,0,0]);c.fill();glow(c,x+8,-47,22,'#eacd8740')}c.fillStyle='#1c273d';c.fillRect(-11,-11,22,29);c.strokeStyle='#b6a87c';c.lineWidth=3;c.beginPath();c.moveTo(0,-129);c.lineTo(0,-145);c.stroke();ellipse(c,0,-148,3,3,'#dabf7d');c.restore();
 c.save();c.translate(923,247);line(c,[[0,0],[-22,62]],'#bdab8460',2);line(c,[[0,0],[23,62]],'#bdab8460',2);line(c,[[0,0],[1,65]],'#bdab8460',2);c.rotate(-.48);c.fillStyle='#9c9988';c.fillRect(-32,-6,57,11);c.fillStyle='#d0bd8f';c.fillRect(21,-9,5,18);c.restore();
 const p=[[515,80],[568,102],[607,81],[645,124],[625,171]];line(c,p,'#c6b89260',.8);p.forEach(([x,y])=>{ellipse(c,x,y,2,2,'#e1d2b3');glow(c,x,y,9,'#e1d2b34d')});
 }
 function sea(c){c.fillStyle=gradient(c,0,0,0,340,[[0,'#efd3ca'],[.4,'#f8c7ac'],[.63,'#fae0b9'],[1,'#87afa5']]);c.fillRect(0,0,1000,340);glow(c,748,149,136,'#fff3c6b0');ellipse(c,748,144,37,37,'#fff0c1');for(let i=0;i<11;i++){let x=470+noise(i+77)*520,y=35+noise(i)*92;ellipse(c,x,y,40+noise(i+45)*42,4+noise(i+7)*6,'#fff2d557')}
 c.fillStyle=gradient(c,0,182,0,158,[[0,'#97b8ad'],[.7,'#619891'],[1,'#437e7c']]);c.fillRect(0,182,1000,158);hill(c,184,'#648f884a',4,.5);poly(c,[[505,194],[546,171],[573,179],[597,160],[638,184],[653,194]],'#b5b7a0');
 for(let j=0;j<36;j++){let y=188+j*4,w=8+j*1.4,x=748+Math.sin(j*1.7)*7;line(c,[[x-w,y],[x+w,y]],'#ffe0ad'+(Math.floor(150-j*3).toString(16).padStart(2,'0')),1.7)}
 c.beginPath();c.moveTo(790,340);c.bezierCurveTo(860,275,856,248,1000,236);c.lineTo(1000,340);c.fillStyle='#dfba92';c.fill();c.beginPath();c.moveTo(756,340);c.bezierCurveTo(832,275,861,251,1000,240);c.strokeStyle='#f3ead180';c.lineWidth=9;c.stroke();
 c.save();c.translate(891,208);c.fillStyle='#f5e3bd';poly(c,[[-12,0],[-9,-71],[9,-71],[14,0]],'#eee0b7');c.fillStyle='#bc7460';c.fillRect(-9,-56,18,12);c.fillRect(-8,-80,16,12);poly(c,[[-13,-81],[0,-94],[13,-81]],'#925f54');c.fillStyle='#ffedb2';c.fillRect(-5,-79,10,8);glow(c,0,-76,30,'#fff0b973');line(c,[[-16,-67],[16,-67]],'#9a7360',2);c.restore();
 for(let i=0;i<12;i++){let x=858+noise(i)*163,y=290+noise(i+3)*70;line(c,[[x,y],[x-4,y-39]],'#7a8561',1.2);ellipse(c,x-4,y-34,2,11,'#b7a475',-.18)}
 for(let i=0;i<4;i++){let x=664+i*28,y=77+Math.sin(i)*8;c.beginPath();c.moveTo(x-7,y+2);c.quadraticCurveTo(x-3,y-3,x,y);c.quadraticCurveTo(x+3,y-3,x+7,y+2);c.strokeStyle='#856c6670';c.lineWidth=1;c.stroke()}
 }
 function snow(c){c.fillStyle=gradient(c,0,0,0,340,[[0,'#c2d0d1'],[.7,'#e2e8e0'],[1,'#bdc9c3']]);c.fillRect(0,0,1000,340);ellipse(c,723,56,20,20,'#e9ead7');hill(c,172,'#a9bdb9',38,.3);hill(c,204,'#bacac3',19,2);for(let i=0;i<28;i++)pine(c,410+i*25,244+noise(i)*19,76+noise(i+3)*68,'#8aa59a');hill(c,258,'#e4e9df',19,1);hill(c,303,'#d4ddd3',18,4);for(const [x,y,h] of [[957,291,194],[889,274,132],[521,272,120],[581,261,75]])pine(c,x,y,h,'#607f70',true);cottage(c,738,258,.78,true);c.beginPath();c.moveTo(738,279);c.bezierCurveTo(740,308,796,324,826,340);c.strokeStyle='#afbbab';c.lineWidth=12;c.stroke();c.strokeStyle='#eae5d4';c.lineWidth=6;c.stroke();for(let i=0;i<8;i++){let x=771+i*5,y=298+i*5;ellipse(c,x,y,1.3,2,'#909f963c')}
 for(let i=0;i<25;i++){let x=500+noise(i)*500,y=292+noise(i+8)*47;ellipse(c,x,y,noise(i+9)*12+4,3,'#becdc055')}
 c.save();c.strokeStyle='#716c5745';c.lineWidth=1.8;for(let i=0;i<7;i++){let x=441+i*15;line(c,[[x,340],[x-6,300-noise(i)*40]],'#8b8b7150',1);line(c,[[x-4,314],[x-13,306]],'#8b8b7150',1)}c.restore();
 }
 function box(c,x,y,w,h,color,r=0){c.beginPath();c.roundRect(x,y,w,h,r);c.fillStyle=color;c.fill()}
 function maple(c,x,y,s,angle,col){c.save();c.translate(x,y);c.rotate(angle);c.scale(s,s);poly(c,[[0,-1],[-.2,-.43],[-.52,-.68],[-.45,-.22],[-.93,-.32],[-.66,.1],[-.81,.36],[-.32,.4],[-.14,.72],[0,.48],[.18,.7],[.36,.4],[.78,.36],[.65,.08],[.93,-.32],[.44,-.22],[.55,-.68],[.19,-.43]],col);line(c,[[0,.72],[0,-.65]],'#6e462566',.07);line(c,[[0,.66],[.09,1.12]],col,.1);c.restore()}
 function mapleTree(c,x,y,h,seed=0){c.save();c.translate(x,y);poly(c,[[-10,0],[-4,-h],[6,-h],[12,0]],'#6a503b');line(c,[[0,-h*.49],[-h*.24,-h*.8]],'#6a503b',6);line(c,[[0,-h*.66],[h*.23,-h*.94]],'#6a503b',5);for(let i=0;i<72;i++){const a=noise(i+seed)*6.28,r=Math.sqrt(noise(i+30+seed))*h*.41;const px=Math.cos(a)*r,py=-h*.85+Math.sin(a)*r*.51;ellipse(c,px,py,14+noise(i+20)*15,10+noise(i+7)*12,['#a86143','#b27345','#bf8050','#b65f43','#99533d','#d09a62'][i%6],a*.2);if(i%3===0)maple(c,px+5,py+5,9,a,'#dc9e65')}c.restore()}
 function forestPath(c){c.fillStyle=gradient(c,0,0,0,340,[[0,'#a9c9a6'],[.6,'#7d9f83'],[1,'#476951']]);c.fillRect(0,0,1000,340);glow(c,754,101,195,'#eef3c576');for(let layer=0;layer<3;layer++){for(let i=0;i<16;i++){let x=390+i*44+noise(i)*15;c.fillStyle=['#6d957b45','#4f775e58','#30543e80'][layer];c.fillRect(x+layer*5,-10,5+layer*3,220+noise(i)*30);line(c,[[x,130],[x-30,75]],c.fillStyle,3+layer)}}hill(c,231,'#608666',21,2);hill(c,283,'#527950',15,.4);
 c.beginPath();c.moveTo(693,165);c.bezierCurveTo(620,218,821,246,723,340);c.lineTo(862,340);c.bezierCurveTo(885,280,687,199,709,165);c.fillStyle='#a7b898';c.fill();c.beginPath();c.moveTo(789,182);c.bezierCurveTo(695,233,870,254,1000,282);c.lineTo(1000,310);c.bezierCurveTo(812,282,670,233,789,182);c.fillStyle='#8cb7aa';c.fill();
 for(let j=0;j<7;j++)line(c,[[733+j*10,229+j*2],[791+j*11,239+j*3]],'#d7e8ca60',1);c.save();c.translate(773,239);c.rotate(.21);box(c,-52,-8,112,12,'#8c7855',2);for(let j=0;j<9;j++)line(c,[[-47+j*12,-8],[-47+j*12,4]],'#c2ad77',1);line(c,[[-50,-18],[58,-18]],'#968260',3);line(c,[[-47,0],[-47,-25]],'#6b6948',3);line(c,[[53,0],[53,-25]],'#6b6948',3);c.restore();
 for(const [x,w,h] of [[475,32,345],[959,40,390],[560,16,315]]){c.beginPath();c.moveTo(x-w*.65,340);c.quadraticCurveTo(x-8,150,x+w*.2,-20);c.lineTo(x+w,-20);c.quadraticCurveTo(x+8,180,x+w,340);c.fillStyle='#36583f';c.fill();line(c,[[x+10,123],[x+80,35]],'#36583f',11)}for(let i=0;i<38;i++){let x=470+noise(i+390)*565,y=noise(i+45)*67;ellipse(c,x,y,30+noise(i)*34,20,'#416847',noise(i));}
 for(let i=0;i<42;i++){const x=420+noise(i+88)*590,y=279+noise(i+11)*55;ellipse(c,x,y,6+noise(i)*10,4,'#809b5b');if(i%4===0){line(c,[[x,y],[x-4,y-18]],'#a6b978',1);ellipse(c,x-4,y-18,2,2,'#eedfa2')}}poly(c,[[707,0],[719,0],[909,297],[808,286]],'#f9fac311');
 }
 function starTerrace(c){c.fillStyle=gradient(c,0,0,0,340,[[0,'#101a30'],[.6,'#454569'],[1,'#867783']]);c.fillRect(0,0,1000,340);glow(c,768,100,166,'#cfb1c331');for(let i=0;i<145;i++){let x=390+noise(i+1)*610,y=noise(i+256)*239;ellipse(c,x,y,.5+noise(i)*1.2,.5+noise(i)*1.2,'#e2d7c6bd')}ellipse(c,870,62,24,24,'#e7d3a4');ellipse(c,879,54,23,23,'#323853');hill(c,256,'#25314b',25,4);
 poly(c,[[376,290],[1000,263],[1000,340],[376,340]],'#4f5062');line(c,[[400,257],[998,250]],'#a99670',2);line(c,[[400,282],[998,275]],'#a9967075',1);for(let i=0;i<18;i++)line(c,[[416+i*35,256],[416+i*35,298]],'#9e8c6e',2);for(let j=0;j<5;j++)line(c,[[452+j*118,288],[386+j*147,340]],'#8d7e7339',1);
 c.save();c.translate(772,233);for(const x of [-57,12,59])line(c,[[0,0],[x,91]],'#a79269',5);ellipse(c,0,0,10,10,'#d4bc84');c.rotate(-.49);box(c,-49,-12,111,24,'#9d906d',3);box(c,47,-18,18,36,'#cdb47c',2);box(c,-57,-7,18,14,'#cdb47c',2);box(c,-20,-5,58,3,'#d7c598',1);c.restore();
 c.save();c.translate(970,124);c.beginPath();c.arc(0,0,126,Math.PI,Math.PI*1.55);c.lineTo(0,0);c.fillStyle='#45455b';c.fill();line(c,[[-126,0],[-110,0]],'#c2a97d',4);c.restore();const p=[[568,42],[607,85],[655,75],[675,126]];line(c,p,'#c4af8066',.8);p.forEach(([x,y])=>ellipse(c,x,y,2,2,'#e4d9bd'));
 }
 function shoreline(c,offset=0){c.moveTo(468,350+offset);c.bezierCurveTo(551,293+offset,657,286+offset,755,268+offset);c.bezierCurveTo(849,251+offset,928,239+offset,1012,211+offset)}
 function seaShore(c){c.fillStyle=gradient(c,0,0,0,340,[[0,'#e9bfc0'],[.52,'#ffe0b3'],[1,'#80aaa3']]);c.fillRect(0,0,1000,340);ellipse(c,766,127,32,32,'#fff0c3');glow(c,766,127,98,'#ffdfa84d');for(let i=0;i<7;i++)ellipse(c,510+i*76,47+noise(i)*36,40+noise(i+9)*23,4,'#fbe7d24a');
 c.fillStyle=gradient(c,0,144,0,340,[[0,'#b7c9b900'],[.07,'#b7c9b9b0'],[.19,'#a2beb1'],[.65,'#76a49d'],[1,'#5e9793']]);c.fillRect(0,144,1000,196);
 c.beginPath();c.moveTo(391,162);c.bezierCurveTo(426,159,454,144,478,151);c.bezierCurveTo(501,157,522,151,556,164);c.closePath();c.fillStyle='#a4b2a543';c.fill();
 c.save();c.beginPath();shoreline(c);c.lineTo(1012,360);c.lineTo(468,360);c.closePath();c.fillStyle=gradient(c,0,213,0,340,[[0,'#efdab9'],[.45,'#ecd0aa'],[1,'#e3bf95']]);c.fill();c.clip();c.beginPath();shoreline(c,5);c.lineWidth=17;c.strokeStyle='#b5c8b04a';c.stroke();c.restore();
 c.beginPath();shoreline(c);c.lineWidth=3;c.lineCap='round';c.strokeStyle='#fff2d8b0';c.stroke();c.lineCap='butt';
 for(let i=0;i<13;i++){let x=690+i*14,y=302-i*4;ellipse(c,x,y,2.3,4.2,'#b18c6960',-.4);ellipse(c,x+7,y+8,2.3,4.2,'#b18c6960',-.4)}for(let i=0;i<18;i++){let x=590+noise(i+31)*400,y=274+noise(i+67)*64;ellipse(c,x,y,1+noise(i)*2,1.1,'#b1987560')}
 c.save();c.translate(925,306);c.rotate(-.23);box(c,-43,-18,86,7,'#b7946c',2);for(let j=0;j<5;j++)box(c,-40+j*18,-40,7,66,'#9a835f',2);c.restore();for(let i=0;i<8;i++){let x=968+noise(i)*31;c.beginPath();c.moveTo(x,340);c.quadraticCurveTo(x-8,288,x-25,269-noise(i)*24);c.strokeStyle='#8c9370';c.lineWidth=1.3;c.stroke()}
 c.save();c.translate(644,302);c.rotate(.2);c.beginPath();c.moveTo(0,0);c.arc(0,0,9,Math.PI*1.1,Math.PI*1.95);c.closePath();c.fillStyle='#f9e5cc';c.fill();for(let j=0;j<4;j++)line(c,[[0,0],[-7+j*4,-6]],'#c5a688',.6);c.restore();
 }
 function snowPorch(c){c.fillStyle=gradient(c,0,0,0,340,[[0,'#b7caca'],[1,'#e5e8db']]);c.fillRect(0,0,1000,340);for(let i=0;i<18;i++)pine(c,410+i*37,271,104+noise(i)*122,'#90aaa0',i%3===0);hill(c,287,'#d9e2d7',8,2);cottage(c,748,286,1.48,true);pine(c,964,333,327,'#486d5f',true);pine(c,496,329,205,'#6b8a76',true);
 box(c,623,302,252,10,'#9a8970',2);box(c,636,311,225,8,'#b3a28b',2);box(c,646,319,205,7,'#dddcd0',2);box(c,632,298,244,5,'#eeeade',2);for(let j=0;j<5;j++)line(c,[[637+j*20,306],[632+j*21,331]],'#9d8c7419',1);
 line(c,[[620,117],[620,151]],'#6c6654',2);box(c,609,150,22,34,'#726448',3);box(c,613,156,14,23,'#f5d999',1);glow(c,620,165,36,'#f6cb8260');poly(c,[[607,150],[620,140],[633,150]],'#746647');for(let i=0;i<7;i++)ellipse(c,558+noise(i)*92,321+noise(i+6)*19,noise(i+11)*17+5,5,'#e7e9df');
 }
 function woodOutside(c){c.fillStyle=gradient(c,0,0,0,340,[[0,'#e9dbc2'],[.55,'#dfc597'],[1,'#b29b69']]);c.fillRect(0,0,1000,340);glow(c,689,91,210,'#ffe9ba77');ellipse(c,724,77,29,29,'#f8e9bc');hill(c,158,'#b9b28b',24,1);hill(c,201,'#a4aa7e',20,3);box(c,405,213,595,90,'#aab3a0');for(let j=0;j<11;j++)line(c,[[445,220+j*6],[990,216+j*6]],'#ded4ae29',1);
 hill(c,288,'#ae985f',22,2);c.beginPath();c.moveTo(582,340);c.bezierCurveTo(721,295,699,260,775,244);c.lineTo(803,244);c.bezierCurveTo(724,285,832,293,786,340);c.fillStyle='#cfb080';c.fill();cottage(c,806,232,.49);mapleTree(c,487,316,249,8);mapleTree(c,966,328,301,130);mapleTree(c,585,247,146,48);
 for(let i=0;i<48;i++){let x=430+noise(i+98)*565,y=291+noise(i)*46;maple(c,x,y,2+noise(i+300)*5,noise(i+12)*6,['#a5583e','#bc7549','#d1a064'][i%3])}for(let i=0;i<9;i++){let x=876+i*12;line(c,[[x,280],[x,310]],'#816a49',2)}line(c,[[872,281],[988,281]],'#947d56',3);
 }
 function woodVeranda(c){c.fillStyle=gradient(c,0,0,0,340,[[0,'#ecd8b3'],[1,'#b2b28e']]);c.fillRect(0,0,1000,340);hill(c,178,'#b4b391',18,3);hill(c,224,'#989e77',14,1);mapleTree(c,906,259,249,72);mapleTree(c,570,270,224,167);
 poly(c,[[409,253],[1000,253],[1000,340],[366,340]],'#bd9871');for(let j=0;j<9;j++)line(c,[[420+j*72,251],[362+j*92,340]],'#8e6f4b55',1);for(let j=0;j<4;j++)line(c,[[403-j*8,269+j*23],[1000,269+j*23]],'#d4b28c',1);box(c,448,237,552,10,'#97754f',2);for(let j=0;j<13;j++)box(c,461+j*43,239,6,48,'#a18159');box(c,471,0,16,259,'#92724e');box(c,468,0,22,16,'#775d44');
 c.save();c.translate(765,264);box(c,-58,-18,114,12,'#866441',3);box(c,-54,-44,109,6,'#987552',2);box(c,-54,-35,109,6,'#987552',2);for(const x of [-49,45])box(c,x,-39,6,69,'#826342');c.restore();box(c,649,281,78,8,'#ab8053',3);line(c,[[659,286],[652,325]],'#8f6c46',4);line(c,[[715,286],[722,325]],'#8f6c46',4);coffee(c,685,281,.6,'#f3e5ca');box(c,830,290,31,28,'#a36e4e',3);for(let i=0;i<7;i++){line(c,[[845,292],[827+noise(i)*35,260-noise(i)*20]],'#6a7951',1.5);ellipse(c,827+noise(i)*35,260-noise(i)*20,5,3,'#7c8b5b',i)}for(let i=0;i<18;i++)maple(c,540+noise(i+19)*440,291+noise(i+70)*45,3+noise(i)*5,noise(i)*6,['#a45c42','#b7764d','#bda063'][i%3]);
 }
 function studyOutside(c){c.fillStyle=gradient(c,0,0,0,340,[[0,'#343940'],[.68,'#525650'],[1,'#3c3d38']]);c.fillRect(0,0,1000,340);glow(c,800,124,170,'#c5b47a16');for(let i=0;i<13;i++){let x=401+i*53,h=50+noise(i)*78;box(c,x,229-h,48,h,'#333d3b');if(i%2===0)box(c,x+7,242-h,4,7,'#c4ad6877')}
 box(c,615,114,288,181,'#51443b');poly(c,[[592,120],[756,57],[925,120]],'#2e3331');line(c,[[596,120],[920,120]],'#a58c6660',3);box(c,725,237,57,57,'#282b29');box(c,732,244,44,37,'#b49b6760');for(let row=0;row<2;row++)for(let j=0;j<4;j++){const x=638+j*64,y=143+row*58;box(c,x-3,y-3,34,43,'#302e27',2);box(c,x,y,28,37,'#d3b87c',1);glow(c,x+14,y+18,24,'#e0be6945');line(c,[[x+14,y],[x+14,y+37]],'#6c5a3f',2);line(c,[[x,y+17],[x+28,y+17]],'#6c5a3f',2)}
 box(c,602,293,315,9,'#8a7d66');box(c,594,302,330,6,'#77725e');poly(c,[[440,340],[688,306],[824,306],[950,340]],'#605b48');for(let j=0;j<4;j++)line(c,[[520,317+j*6],[946,315+j*6]],'#aaa07a21',1);for(let i=0;i<24;i++)line(c,[[622+noise(i)*285,307+noise(i+5)*33],[633+noise(i)*285,307+noise(i+5)*33]],'#d6b97140',1);
 line(c,[[551,168],[551,310]],'#242e2b',4);box(c,542,159,18,28,'#a08855',2);box(c,545,164,12,19,'#ddc788');glow(c,551,176,50,'#e9c47830');poly(c,[[537,159],[551,149],[565,159]],'#33352d');
 }
 function studyWindow(c){c.fillStyle=gradient(c,0,0,0,340,[[0,'#373b3b'],[1,'#4c4338']]);c.fillRect(0,0,1000,340);for(let i=0;i<15;i++){let x=425+noise(i)*180,y=75+noise(i+5)*190;glow(c,x,y,8+noise(i+17)*9,'#ccb78427')}
 box(c,623,-8,303,329,'#634c37');for(let j=0;j<16;j++){line(c,[[624,12+j*21],[926,12+j*21]],'#9170523b',1);for(let k=0;k<5;k++)line(c,[[636+k*62+(j%2)*25,12+j*21],[636+k*62+(j%2)*25,33+j*21]],'#91705230',1)}box(c,650,23,248,259,'#332e27',86);box(c,658,31,232,245,gradient(c,0,30,0,250,[[0,'#a88754'],[.8,'#d3b37e'],[1,'#aa8c5c']]),80);
 for(let j=0;j<3;j++){box(c,674,114+j*39,191,5,'#7f6849');for(let i=0;i<14;i++){let h=18+noise(i+j)*15;box(c,678+i*13,112+j*39-h,9,h,['#626a4f','#826347','#b19a70','#8b7656'][i%4],1)}}box(c,771,32,5,245,'#5c4832');box(c,657,106,235,5,'#5c4832');box(c,642,278,266,9,'#876847');
 line(c,[[606,280],[944,280]],'#222d2a',4);line(c,[[606,302],[944,302]],'#222d2a',2);for(let j=0;j<14;j++)line(c,[[612+j*25,280],[612+j*25,340]],'#242e2a',2);for(let i=0;i<14;i++){const x=604+noise(i)*34,y=120+noise(i+7)*177;ellipse(c,x,y,9,4,'#465847',i*.5)}
 }
 function coffee(c,x,y,s=1,col='#e9dfca'){c.save();c.translate(x,y);c.scale(s,s);ellipse(c,0,0,24,5,'#32281926');ellipse(c,0,-1,19,4,'#d8cab0');box(c,-13,-24,26,23,col,[2,2,7,7]);c.beginPath();c.arc(15,-15,7,-1.7,1.8);c.strokeStyle=col;c.lineWidth=3;c.stroke();ellipse(c,0,-24,13,4,col);ellipse(c,0,-24,10,2.7,'#7a5c3c');c.restore()}
 function books(c,x,y,w=140){const cols=['#6f7e66','#ad8861','#bea986','#826a51','#777461'];for(let i=0;i<3;i++){box(c,x+i*5,y-i*9,w-i*15,8,cols[i],1);box(c,x+6+i*5,y+2-i*9,w-12-i*15,4,'#e0d6ba',1)}}
 function openBook(c,x,y,s=1){c.save();c.translate(x,y);c.scale(s,s);poly(c,[[-67,3],[-58,-36],[0,-29],[58,-36],[68,3],[0,9]],'#a58d62');poly(c,[[-62,0],[-54,-34],[0,-27],[0,6]],'#eee2c2');poly(c,[[0,6],[0,-27],[53,-34],[63,0]],'#f5ebd5');line(c,[[0,-27],[0,6]],'#ad956b',1);for(let j=0;j<6;j++){line(c,[[8,-21+j*4],[43+j,-26+j*4]],'#ab967659',.7);line(c,[[-45-j,-26+j*4],[-8,-21+j*4]],'#ab967659',.7)}c.restore()}
 // Garden motifs are painted once into the landscape. Only their light, petals,
 // stems and rain live in the motion layer, so pausing retains a complete place.
 function flower(c,x,y,r,col='#f1c2c9',angle=0){
  c.save();c.translate(x,y);c.rotate(angle);
  for(let j=0;j<5;j++){const a=j*Math.PI*2/5;ellipse(c,Math.cos(a)*r*.48,Math.sin(a)*r*.48,r*.47,r*.3,col,a)}
  ellipse(c,0,0,r*.18,r*.18,'#ddab69');c.restore();
 }
 function leafyPlant(c,x,y,s=1,pot='#be8c71',leaves='#6e9375'){
  c.save();c.translate(x,y);c.scale(s,s);ellipse(c,0,3,21,5,'#49574920');
  poly(c,[[-17,-24],[17,-24],[12,1],[-12,1]],pot);ellipse(c,0,-24,17,4,'#caa98b');
  for(let i=0;i<7;i++){const a=-2.8+i*.43,h=25+noise(i+41)*19,tx=Math.cos(a)*h,ty=-24+Math.sin(a)*h;
   line(c,[[0,-23],[tx*.7,ty+7],[tx,ty]],'#68856b',1.1);ellipse(c,tx,ty,11,4.5,leaves,a);
   line(c,[[tx-4*Math.cos(a),ty-4*Math.sin(a)],[tx+5*Math.cos(a),ty+5*Math.sin(a)]],'#d9e5b64d',.6);
  }c.restore();
 }
 function blossomTree(c,x,y,h,seed=0){
  c.save();c.translate(x,y);poly(c,[[-h*.033,0],[-h*.014,-h],[h*.012,-h],[h*.043,0]],'#96796c');
  line(c,[[0,-h*.4],[-h*.24,-h*.78],[-h*.33,-h*.94]],'#96796c',Math.max(2,h*.019));
  line(c,[[2,-h*.58],[h*.2,-h*.91],[h*.3,-h*.98]],'#96796c',Math.max(2,h*.015));
  line(c,[[h*.009,-h*.08],[h*.002,-h*.65]],'#c2a394',Math.max(1,h*.007));
  for(let i=0;i<64;i++){const a=noise(i+seed)*6.283,r=Math.sqrt(noise(i+35+seed))*h*.4,px=Math.cos(a)*r,py=-h*.85+Math.sin(a)*r*.45;
   ellipse(c,px,py,h*(.036+noise(i+17)*.032),h*(.028+noise(i+38)*.03),['#e9acb6','#efbbc3','#f4cbd0','#f9dce0','#eeb8c2'][i%5],a*.2);
   if(i%2===0)flower(c,px+3,py-3,h*.021,['#fce9e5','#fff1e7','#f6d2d5'][i%3],a);
  }c.restore();
 }
 function springGround(c,y=252){
  hill(c,y,'#b7c69a',13,2);hill(c,y+31,'#9daf83',12,.5);
  for(let i=0;i<76;i++){const x=435+noise(i+10)*585,py=y+12+noise(i+81)*(328-y);line(c,[[x,py+5],[x-2,py-4]],'#7b9870',.7);
   if(i%3===0)flower(c,x,py-4,1.6+noise(i)*1.4,['#fff7df','#edbfc7','#f5e5be'][i%3]);
  }
 }
 function bookshop(c,x,y,s=1){
  c.save();c.translate(x,y);c.scale(s,s);ellipse(c,0,8,125,15,'#6f7d5930');
  box(c,-91,-133,182,137,'#f7e6ce',2);poly(c,[[-107,-130],[-5,-187],[106,-130]],'#bd8e87');
  line(c,[[-107,-130],[-5,-187],[106,-130]],'#e2b4a3',4);line(c,[[-91,-128],[91,-128]],'#a88177',4);
  for(let i=0;i<3;i++){const wx=-72+i*53;box(c,wx,-99,40,75,'#a69173',[19,19,0,0]);box(c,wx+3,-96,34,68,'#d9bd87',[17,17,0,0]);
   glow(c,wx+20,-59,25,'#fff0b463');line(c,[[wx+20,-94],[wx+20,-27]],'#ad8d70',2);
   for(let j=0;j<4;j++)box(c,wx+5+j*7,-47,5,17+noise(j+i)*7,['#a78a88','#8c9c7d','#c7ad77'][j%3],1);
  }
  box(c,-24,-59,48,64,'#718979',[23,23,0,0]);box(c,-17,-52,34,40,'#f7dca9',[16,16,0,0]);line(c,[[0,-53],[0,-12]],'#9b9176',2);
  ellipse(c,16,-8,1.6,1.6,'#e7cb8e');box(c,-42,-124,84,16,'#f9ecda',3);
  c.fillStyle='#846960';c.font='9px Georgia, serif';c.textAlign='center';c.fillText('B O O K S',0,-113);
  box(c,-96,3,192,6,'#c6b39b',2);box(c,-47,10,94,5,'#dbccb5',2);
  for(const px of [-80,79])leafyPlant(c,px,8,.48,'#cf9a87','#84986f');c.restore();
 }
 function blossomLane(c){
  c.fillStyle=gradient(c,0,0,0,340,[[0,'#fbe7e2'],[.5,'#fbefd8'],[1,'#c3cc9e']]);c.fillRect(0,0,1000,340);
  glow(c,720,80,216,'#fff6d6c0');hill(c,181,'#d1d5ae',20,1);hill(c,226,'#b6c799',18,3);
  for(let i=0;i<5;i++)blossomTree(c,510+i*94,220,72+noise(i)*27,70+i*11);
  springGround(c,251);c.beginPath();c.moveTo(593,340);c.bezierCurveTo(647,301,805,280,803,220);c.lineTo(825,220);c.bezierCurveTo(877,275,760,312,794,340);c.fillStyle='#e6ccb0';c.fill();
  bookshop(c,818,239,.65);blossomTree(c,496,306,252,81);blossomTree(c,983,332,320,129);
  for(let i=0;i<25;i++){const x=585+noise(i+52)*361,y=284+noise(i+96)*54;ellipse(c,x,y,2.3,1.1,'#f7d1d0',noise(i)*3)}
  for(let i=0;i<7;i++)line(c,[[906+i*15,263],[906+i*15,292]],'#b5b48e',2);line(c,[[903,264],[1000,264]],'#ded4b3',3);
 }
 function blossomTerrace(c){
  c.fillStyle=gradient(c,0,0,0,340,[[0,'#f8e4df'],[.6,'#f9edd7'],[1,'#cfceaa']]);c.fillRect(0,0,1000,340);
  hill(c,230,'#bac79f',17,1.6);for(let i=0;i<3;i++)blossomTree(c,478+i*107,258,118+i*14,142+i*17);
  box(c,815,0,185,288,'#ead0bc');box(c,840,40,138,220,'#a9897b',[66,66,0,0]);box(c,847,47,124,210,'#efd6a7',[59,59,0,0]);
  for(let j=0;j<3;j++){box(c,855,118+j*49,111,4,'#a68c6b');for(let i=0;i<8;i++)box(c,859+i*13,115+j*49-22-noise(i+j)*13,9,22+noise(i+j)*13,['#a1a789','#bc9597','#cfad7d','#8c9f8d'][i%4],1)}
  line(c,[[909,49],[909,257]],'#b2987f',4);box(c,826,255,167,9,'#c0a184',2);
  poly(c,[[821,104],[1000,104],[1000,149],[817,144]],'#faf0da');for(let i=0;i<6;i++)poly(c,[[829+i*30,105],[844+i*30,105],[843+i*30,145],[828+i*30,144]],'#cd9692');
  poly(c,[[413,286],[1000,277],[1000,340],[395,340]],'#dbbd9f');for(let i=0;i<8;i++)line(c,[[430+i*80,284],[405+i*91,340]],'#bd9f8370',.8);
  box(c,497,252,239,7,'#b8b192',2);for(let j=0;j<8;j++)box(c,505+j*31,258,3,37,'#c4bd9c');
  c.save();c.translate(746,282);ellipse(c,0,0,50,13,'#bb977b');line(c,[[0,8],[0,52]],'#9b8069',4);line(c,[[-27,52],[25,52]],'#9b8069',3);coffee(c,-15,-1,.55,'#fff3df');openBook(c,18,1,.34);c.restore();
  for(const x of [660,822]){box(c,x,281,39,7,'#a0aa8b',4);line(c,[[x+5,286],[x+1,326]],'#8c9a7b',3);line(c,[[x+32,286],[x+37,326]],'#8c9a7b',3);box(c,x,248,39,25,'#b4bfa1',8)}
  leafyPlant(c,942,316,1.1,'#c99b83','#829571');blossomTree(c,482,339,343,250);
  for(let i=0;i<17;i++)ellipse(c,600+noise(i)*350,303+noise(i+72)*33,2.8,1.4,'#f4c4cb',noise(i)*4);
 }
 function lavenderSprig(c,x,y,h=28,lean=0,col='#9d8cb8'){
  const top=x+lean;line(c,[[x,y],[top,y-h]],'#839277',.7+h*.01);
  ellipse(c,x-3,y-h*.35,5+h*.08,1.4,'#98a88a',-.55);ellipse(c,x+4,y-h*.51,5+h*.07,1.4,'#9dad90',.35);
  for(let j=0;j<5;j++){const yy=y-h+j*h*.075;ellipse(c,top+(j%2?2:-2),yy,1.7+h*.025,2.3+h*.025,col,j%2?.25:-.25)}
 }
 function lavenderRows(c,horizon=198){
  hill(c,horizon,'#bbc198',12,1);for(let row=0;row<8;row++){
   const end=395+row*96,start=720+(row-3.5)*16;c.beginPath();c.moveTo(start,horizon);c.bezierCurveTo(start+(end-start)*.2,247,end-25,290,end-30,350);c.lineTo(end+27,350);c.bezierCurveTo(end+13,280,start+(end-start)*.29,236,start+7,horizon);c.fillStyle=['#9e91b6','#b0a1c1','#8e83a7'][row%3];c.fill();
   for(let i=0;i<19;i++){const u=(i+1)/19,y=horizon+(340-horizon)*u,x=start+(end-start)*u*u;lavenderSprig(c,x-8+noise(i+row)*15,y,3+u*u*19,(noise(i)*2-1)*u*4,['#cab6d6','#b6a1ca','#e0cadf'][i%3])}
  }
 }
 function countryHouse(c,x,y,s=1){
  c.save();c.translate(x,y);c.scale(s,s);box(c,-65,-108,130,110,'#e6d4b4',2);poly(c,[[-80,-105],[-8,-158],[82,-105]],'#b69087');
  for(let j=0;j<4;j++)line(c,[[-60+j*7,-119-j*9],[64-j*18,-119-j*9]],'#d8aaa078',1);
  box(c,-12,-51,27,53,'#8b927d',[13,13,0,0]);box(c,-51,-81,28,34,'#f8e7b9',3);box(c,29,-81,28,34,'#f8e7b9',3);
  for(const xx of [-60,-21,20,59])box(c,xx,-82,8,35,'#9993a6',1);for(const xx of [-37,43])line(c,[[xx,-79],[xx,-48]],'#b8a389',1.5);
  line(c,[[-67,2],[68,2]],'#c1b091',4);c.restore();
 }
 function lavenderField(c){
  c.fillStyle=gradient(c,0,0,0,340,[[0,'#e9e4f1'],[.47,'#f7eacb'],[1,'#bcb39b']]);c.fillRect(0,0,1000,340);
  ellipse(c,816,65,25,25,'#fff3cf');glow(c,816,65,174,'#fff4d17c');hill(c,159,'#c9c3cd',25,2);hill(c,178,'#b3b6a0',18,1);
  for(let i=0;i<4;i++)ellipse(c,588+i*110,48+noise(i)*41,36+noise(i)*39,5,'#fff8ea72');
  countryHouse(c,795,199,.48);for(const x of [751,841,876]){box(c,x-2,166,4,34,'#8a8e73');ellipse(c,x,166,8,31,'#849681')}
  lavenderRows(c,205);poly(c,[[736,207],[749,207],[897,340],[851,340]],'#d8c6ab');
  for(let i=0;i<16;i++)lavenderSprig(c,465+noise(i+54)*530,321+noise(i+78)*21,24+noise(i)*21,(noise(i+2)-.5)*9,['#b09bc4','#c2a9d3','#8d7da5'][i%3]);
 }
 function lavenderGarden(c){
  c.fillStyle=gradient(c,0,0,0,340,[[0,'#e8e0ed'],[.55,'#f4e7c9'],[1,'#bfc8a1']]);c.fillRect(0,0,1000,340);hill(c,185,'#c0c2ad',16,3);hill(c,233,'#a7b78f',12,2);
  countryHouse(c,860,254,1.23);poly(c,[[693,340],[830,256],[858,256],[885,340]],'#e0ceb2');
  box(c,417,261,273,53,'#c4b79d',4);for(let j=0;j<4;j++){line(c,[[419,269+j*13],[689,269+j*13]],'#e3d7bd',1.5);for(let i=0;i<8;i++)line(c,[[424+i*36+(j%2)*14,257+j*13],[424+i*36+(j%2)*14,270+j*13]],'#dfd0b6',1)}
  box(c,413,254,280,10,'#d9ccb2',2);for(let i=0;i<27;i++)lavenderSprig(c,424+noise(i+6)*257,258,18+noise(i)*35,(noise(i+4)-.5)*9,['#b29ac3','#cab5d8','#9983b1'][i%3]);
  for(let i=0;i<6;i++)ellipse(c,494+noise(i+15)*160,215+noise(i)*19,25,10,'#9daa85');
  box(c,694,264,44,40,'#b99277',[2,2,12,12]);for(let i=0;i<14;i++)lavenderSprig(c,701+noise(i+64)*32,265,29+noise(i)*25,(noise(i+3)-.5)*13,['#bca5d0','#967fad'][i%2]);
  c.save();c.translate(918,292);ellipse(c,0,0,34,8,'#b29574');line(c,[[-18,5],[-25,42]],'#a08468',3);line(c,[[18,5],[25,42]],'#a08468',3);coffee(c,0,0,.5,'#f9eed7');c.restore();
  for(let i=0;i<3;i++){const x=994-i*16;line(c,[[x,280],[x,100-i*8]],'#7e8c70',4);ellipse(c,x,151-i*9,20,57,'#8fa281')}
  for(let i=0;i<18;i++)lavenderSprig(c,460+noise(i+82)*530,336+noise(i)*10,22+noise(i)*35,(noise(i+1)-.5)*13,['#9f86b5','#baa0cd'][i%2]);
 }
 function rainFoliage(c,x,y,s=1){
  for(let i=0;i<13;i++){const px=x+(noise(i+61)-.5)*s*70,py=y-noise(i+76)*s*58;
   line(c,[[x,y+17*s],[px,py]],'#668674',1.1*s);ellipse(c,px,py,12*s,5*s,['#9eb79d','#769d85','#b2c5a4'][i%3],noise(i)*3);
   ellipse(c,px+3*s,py-2*s,3*s,1*s,'#e8ecd19c',-.3);
  }
 }
 function greenhouse(c,x,y,s=1){
  c.save();c.translate(x,y);c.scale(s,s);ellipse(c,0,4,138,20,'#55776b29');
  box(c,-108,-131,216,135,gradient(c,0,-130,0,134,[[0,'#d8e6d4'],[1,'#f6dfad']]),1);
  poly(c,[[-123,-130],[0,-192],[123,-130]],'#92b3a2');poly(c,[[-112,-134],[0,-184],[111,-134]],'#c8dcd0');
  for(let i=-2;i<3;i++)line(c,[[i*36,-173+Math.abs(i)*16],[i*48,-130]],'#789a89',2);
  for(let i=0;i<6;i++){const px=-104+i*40;box(c,px,-125,34,116,'#e5e9d45c');line(c,[[px,-127],[px,-1]],'#739382',3);line(c,[[px,-63],[px+38,-63]],'#829f8c',2)}
  for(let i=0;i<5;i++)rainFoliage(c,-88+i*44,-20,.5);
  box(c,-22,-89,44,94,'#6f8c79',[21,21,0,0]);box(c,-17,-82,34,72,'#e4d8af',[17,17,0,0]);line(c,[[0,-82],[0,-10]],'#9ea184',2);ellipse(c,12,-8,1.8,1.8,'#f0d69e');
  glow(c,0,-43,59,'#ffdfad45');box(c,-127,-135,254,7,'#709480',2);box(c,-115,3,230,7,'#9aac90',2);
  box(c,-31,-124,62,18,'#f3e6cc',4);c.fillStyle='#6c816e';c.font='10px Georgia, serif';c.textAlign='center';c.fillText('C A F É',0,-111);
  c.restore();
 }
 function rainyGarden(c){
  c.fillStyle=gradient(c,0,0,0,340,[[0,'#dce7df'],[.6,'#e8ecdb'],[1,'#b2c4a9']]);c.fillRect(0,0,1000,340);
  hill(c,169,'#bfcdc1',20,2);hill(c,215,'#a8bfaa',16,1);for(let i=0;i<8;i++){const x=416+i*88;box(c,x,99,4,144,'#93ac9745');ellipse(c,x,97,28,70,'#aac1ad56')}
  hill(c,280,'#96b09b',18,2);c.beginPath();c.moveTo(616,340);c.bezierCurveTo(681,285,834,288,820,230);c.lineTo(841,230);c.bezierCurveTo(888,285,795,307,816,340);c.fillStyle='#c9caba';c.fill();
  greenhouse(c,826,240,.63);for(let i=0;i<8;i++){const u=i/8,x=697+Math.sin(u*3)*98,y=331-u*71;ellipse(c,x,y,15-u*8,3.5-u*1.5,'#b5bbae');line(c,[[x-9,y-1],[x+8,y-1]],'#e5e9dc',.7)}
  for(const x of [479,571,968])rainFoliage(c,x,310,x===968?1.7:1.2);
  for(let i=0;i<12;i++){const x=429+noise(i+48)*570,y=280+noise(i+5)*58;flower(c,x,y,3+noise(i)*2,['#e2dbe5','#f2ead7','#b7cbd2'][i%3])}
  ellipse(c,768,322,48,5,'#d8e0d7');ellipse(c,861,284,23,3,'#d9e3d5');
 }
 function cafeTerrace(c){
  c.fillStyle=gradient(c,0,0,0,340,[[0,'#dbe7df'],[.65,'#e9eddb'],[1,'#9eb5a0']]);c.fillRect(0,0,1000,340);
  hill(c,252,'#b5c8ac',23,2);for(let i=0;i<4;i++)rainFoliage(c,460+i*36,267,1.2);greenhouse(c,856,280,1.12);
  poly(c,[[436,294],[1000,277],[1000,340],[420,340]],'#c3bda9');for(let j=0;j<6;j++)line(c,[[463+j*92,291],[437+j*107,340]],'#e0dccc',1);
  for(let j=0;j<3;j++)line(c,[[437,305+j*15],[1000,291+j*19]],'#a8ac9780',.8);
  c.save();c.translate(637,255);line(c,[[0,-87],[0,66]],'#9aa38a',3);poly(c,[[-87,-80],[0,-119],[87,-80]],'#e5d9b7');
  poly(c,[[-87,-80],[-14,-100],[0,-119],[0,-80]],'#f5e8c7');poly(c,[[0,-119],[14,-100],[87,-80],[0,-80]],'#d5cba9');
  for(let j=0;j<4;j++){c.beginPath();c.arc(-65+j*43,-80,22,0,Math.PI);c.fillStyle=j%2?'#ded3af':'#ecdfbe';c.fill()}
  ellipse(c,0,31,46,11,'#b39876');line(c,[[-21,38],[-26,77]],'#8c967c',3);line(c,[[21,38],[26,77]],'#8c967c',3);coffee(c,-12,30,.52,'#fff2d8');books(c,7,29,22);c.restore();
  for(const x of [553,695]){box(c,x,286,32,6,'#759680',5);box(c,x,260,32,19,'#90ac96',9);line(c,[[x+3,289],[x,328]],'#6e917c',2.5);line(c,[[x+27,289],[x+31,328]],'#6e917c',2.5)}
  leafyPlant(c,964,321,1.28,'#b18f72','#789d80');leafyPlant(c,754,311,.8,'#bb9780','#95ad8c');
  ellipse(c,846,324,58,5,'#d9d9c392');line(c,[[812,324],[875,323]],'#e9e5c5',1);
 }
 const roomWindow={forest:{x:642,y:19,w:240,h:246,r:100},stars:{x:642,y:15,w:250,h:247,r:120},sea:{x:635,y:12,w:278,h:254,r:110},snow:{x:602,y:22,w:229,h:231,r:8},wood:{x:635,y:13,w:272,h:243,r:7},study:{x:610,y:20,w:234,h:239,r:110},blossom:{x:635,y:14,w:260,h:249,r:125},lavender:{x:621,y:21,w:272,h:239,r:8},cafe:{x:593,y:12,w:349,h:252,r:25}};
 const cups={forest:[806,311],stars:[863,309],sea:[847,309],snow:[762,311],wood:[832,309],study:[810,314],blossom:[813,309],lavender:[849,312],cafe:[793,316]};
 function windowShape(c,r){c.beginPath();c.roundRect(r.x,r.y,r.w,r.h,[r.r,r.r,0,0])}
 function room(c,type){const palettes={forest:['#c7ceb8','#9cae90','#776f4f','#c8b88f'],stars:['#20283b','#343c4c','#998662','#5d5b68'],sea:['#e7cdbd','#d5b6a1','#b78d71','#d5b38a'],snow:['#aa967d','#8c775e','#b7986b','#bc9768'],wood:['#d9c5a3','#c3a782','#92704f','#bf9664'],study:['#443b31','#594939','#ae9162','#96754e']};const [wall,shade,trim,desk]=palettes[type];c.fillStyle=gradient(c,0,0,1000,80,[[0,wall],[1,shade]]);c.fillRect(0,0,1000,340);for(let j=0;j<11;j++)line(c,[[416+j*61,0],[416+j*61,292]],type==='stars'?'#c9b78908':'#60452910',1);
 const r=roomWindow[type];box(c,r.x-10,r.y-10,r.w+20,r.h+20,trim,[r.r+9,r.r+9,2,2]);const outside=document.createElement('canvas');outside.width=1000;outside.height=340;const o=outside.getContext('2d');({forest,stars,sea,snow,wood:woodOutside,study:studyOutside}[type])(o);c.save();windowShape(c,r);c.clip();c.drawImage(outside,410,0,565,332,r.x,r.y,r.w,r.h);if(type==='study')box(c,r.x,r.y,r.w,r.h,'#19322a38');c.restore();line(c,[[r.x+r.w/2,r.y+7],[r.x+r.w/2,r.y+r.h]],trim,5);line(c,[[r.x,r.y+r.h*.48],[r.x+r.w,r.y+r.h*.48]],trim,4);box(c,r.x-14,r.y+r.h+2,r.w+28,10,trim,2);
 if(type==='forest'){box(c,923,41,68,228,'#778569',2);for(let j=0;j<3;j++){box(c,927,101+j*70,63,5,'#465c48');for(let i=0;i<6;i++)box(c,931+i*9,99+j*70-(23+noise(i+j)*17),6,23+noise(i+j)*17,['#d0c4a0','#a09a73','#616c50'][i%3],1)}for(let i=0;i<12;i++){let x=902+Math.sin(i)*16,y=49+i*13;line(c,[[902,26],[902,232]],'#657958',1);ellipse(c,x,y,10,4,'#839365',i%2?-.5:.5)}}
 if(type==='stars'){box(c,913,85,82,181,'#384151');for(let j=0;j<3;j++){box(c,914,132+j*61,80,4,'#b29b6e');for(let i=0;i<7;i++)box(c,917+i*10,128+j*61-28-noise(i)*17,7,28+noise(i)*17,['#69738b','#807075','#b5a381'][i%3],1)}c.save();c.translate(539,226);c.strokeStyle='#b9a16e';c.lineWidth=2;c.beginPath();c.ellipse(0,0,42,52,-.32,0,6.28);c.stroke();ellipse(c,0,0,35,35,'#657485');for(let j=-1;j<2;j++){c.beginPath();c.ellipse(0,0,19+j*6,34,.35,0,6.28);c.strokeStyle='#c0ad7766';c.lineWidth=.8;c.stroke()}line(c,[[0,40],[0,68]],'#c1ab75',3);ellipse(c,0,70,21,4,'#aa9469');c.restore()}
 if(type==='sea'){c.beginPath();c.moveTo(607,0);c.bezierCurveTo(616,88,627,133,608,266);c.lineTo(658,274);c.bezierCurveTo(640,200,648,94,654,0);c.fillStyle='#f2dbcc';c.fill();for(let j=0;j<5;j++)line(c,[[615+j*7,2],[619+j*5,265]],'#bea08825',1);box(c,933,213,28,67,'#d3a780',6);for(let i=0;i<4;i++){line(c,[[946,214],[931+i*10,157+i*7]],'#8b9370',1.2);ellipse(c,933+i*10,159+i*7,10,4,'#ece1bc',-.5)}}
 if(type==='snow'){box(c,864,94,126,220,'#887866',3);for(let j=0;j<9;j++){line(c,[[864,114+j*22],[990,114+j*22]],'#bbaa9055',2);for(let k=0;k<3;k++)line(c,[[871+k*46+(j%2)*12,96+j*22],[871+k*46+(j%2)*12,114+j*22]],'#bbaa9040',1)}box(c,881,205,91,94,'#493c32',[38,38,0,0]);box(c,855,181,144,10,'#bb9b70',2);box(c,854,301,146,12,'#b0a084',2);line(c,[[899,286],[953,273]],'#80583d',9);line(c,[[897,275],[951,289]],'#755139',8);box(c,868,148,28,32,'#8b7555',2);ellipse(c,882,148,14,3,'#c3b394')}
 if(type==='wood'){box(c,936,40,58,229,'#9b7b55');for(let j=0;j<3;j++){box(c,936,101+j*64,58,5,'#715c3d');for(let i=0;i<5;i++)box(c,940+i*10,99+j*64-25-noise(i)*10,7,25+noise(i)*10,['#a85f48','#7d8764','#c0a877'][i%3],1)}poly(c,[[649,257],[807,259],[662,340],[432,340]],'#ffebc421')}
 if(type==='study'){box(c,880,23,115,249,'#594b39');for(let j=0;j<4;j++){box(c,883,78+j*61,110,6,'#a38456');for(let i=0;i<10;i++){let h=29+noise(i+j+7)*15;box(c,888+i*10,76+j*61-h,7,h,['#797757','#94724e','#ab9467','#5c6952'][i%4],1);line(c,[[889+i*10,73+j*61-h],[893+i*10,73+j*61-h]],'#dcc99966',1)}}}
 poly(c,[[446,279],[1000,280],[1000,340],[412,340]],desk);for(let j=0;j<14;j++)line(c,[[430,291+j*4],[1000,289+j*4]],'#f3e1b01a',.6);box(c,414,334,586,6,trim);openBook(c,type==='stars'?731:675,317,type==='sea'?.8:.9);if(type==='sea'){box(c,747,293,50,27,'#f9ecd8',1);line(c,[[748,294],[772,310],[796,294]],'#c4a482',.7)}else books(c,type==='study'?906:906,309,77);const [cx,cy]=cups[type];coffee(c,cx,cy,.82,type==='stars'?'#b5b2ad':'#e9dfca');
 if(type==='study'){ellipse(c,576,318,30,6,'#6f6249');line(c,[[576,314],[576,268],[592,247]],'#b39968',4);box(c,550,237,69,16,'#52654b',[15,15,3,3]);box(c,548,251,73,4,'#b2a173',2);glow(c,579,270,58,'#fbd28539')}
 if(type==='forest'||type==='wood'){box(c,541,283,26,24,type==='forest'?'#7e8c62':'#ae7e55',[1,1,7,7]);for(let i=0;i<6;i++){let x=540+noise(i+3)*31,y=245+noise(i+9)*31;line(c,[[554,285],[x,y]],'#6e7d54',1);ellipse(c,x,y,7,3,'#839468',i*.5)}}
 }
 function gardenRoom(c,type){
  const palettes={blossom:['#f9e9df','#e7c9bd','#b59d82','#e6c7a4'],lavender:['#eee8e5','#d6d0dd','#acaa98','#d8bc95'],cafe:['#e9eee1','#bfcebb','#8ba18b','#cba779']};
  const [wall,shade,trim,desk]=palettes[type],r=roomWindow[type];
  c.fillStyle=gradient(c,0,0,1000,90,[[0,wall],[1,shade]]);c.fillRect(0,0,1000,340);
  for(let j=0;j<9;j++)line(c,[[470+j*65,0],[470+j*65,285]],type==='cafe'?'#72917e14':'#997d7010',1);
  box(c,r.x-10,r.y-10,r.w+20,r.h+20,trim,[r.r+9,r.r+9,0,0]);
  const outside=document.createElement('canvas');outside.width=1000;outside.height=340;const o=outside.getContext('2d');
  ({blossom:blossomLane,lavender:lavenderField,cafe:rainyGarden}[type])(o);
  c.save();windowShape(c,r);c.clip();c.drawImage(outside,435,0,565,330,r.x,r.y,r.w,r.h);c.restore();
  line(c,[[r.x+r.w/2,r.y+7],[r.x+r.w/2,r.y+r.h]],trim,5);line(c,[[r.x,r.y+r.h*.48],[r.x+r.w,r.y+r.h*.48]],trim,4);box(c,r.x-17,r.y+r.h+1,r.w+34,11,trim,2);
  if(type==='blossom'){
   box(c,923,25,77,253,'#c6ab8c');for(let j=0;j<4;j++){box(c,926,81+j*58,73,5,'#ad9476');for(let i=0;i<6;i++){const h=23+noise(i+j)*17;box(c,931+i*11,79+j*58-h,8,h,['#a4ae8f','#bd929a','#e0c3a0','#a99ea4'][i%4],1)}}
   c.beginPath();c.moveTo(604,0);c.bezierCurveTo(613,88,612,151,602,246);c.lineTo(640,259);c.bezierCurveTo(628,177,627,98,637,0);c.fillStyle='#fff1e49e';c.fill();
   for(let j=0;j<4;j++)line(c,[[610+j*7,0],[615+j*6,251]],'#cdb6a333',.8);
   poly(c,[[650,265],[780,265],[649,340],[450,340]],'#fff6d53b');
  }else if(type==='lavender'){
   box(c,925,28,70,10,'#b79a78',2);for(let i=0;i<3;i++){
    const x=937+i*24,y=61+noise(i)*13;line(c,[[x,38],[x,y]],'#9eaa86',1);
    c.save();c.translate(x,y);c.rotate(Math.PI+.12-i*.1);for(let j=0;j<8;j++)lavenderSprig(c,(noise(j+i)*2-1)*10,0,24+noise(j)*15,(noise(j+9)-.5)*10,['#b4a0bb','#c2aec9','#9e8eaa'][j%3]);c.restore();
    line(c,[[x-6,y+4],[x+5,y+4]],'#b5946e',2);
   }
   box(c,934,149,59,102,'#bca989',2);box(c,940,155,47,40,'#f3e8d1',2);c.save();c.translate(964,190);for(let i=0;i<4;i++)lavenderSprig(c,(i-1.5)*4,0,25+noise(i)*7,(i-1.5)*3,'#a092b0');c.restore();
   for(let i=0;i<3;i++)box(c,939,214+i*11,51,7,['#ada894','#a394ae','#d7c3a3'][i]);
  }else{
   for(const x of [963,989]){line(c,[[x,0],[x,42]],'#8ea083',1);box(c,x-12,42,24,22,'#c5a17e',[0,0,8,8]);for(let i=0;i<6;i++){
    const px=x+Math.sin(i*1.4)*18,py=55+i*17;line(c,[[x,60],[px,py]],'#7e9e7b',1);ellipse(c,px,py,10,4,'#94b08b',i*.6);
   }}
   line(c,[[542,0],[542,68]],'#a49676',1.5);poly(c,[[521,67],[563,67],[574,90],[510,90]],'#d5bf8b');ellipse(c,542,90,32,5,'#f5dfaa');glow(c,542,113,64,'#ffdf9445');
   box(c,432,264,116,10,'#b59d78',2);leafyPlant(c,487,264,.7,'#c1a083','#83a181');
  }
  poly(c,[[438,283],[1000,280],[1000,340],[412,340]],desk);for(let i=0;i<14;i++)line(c,[[432,290+i*4],[1000,288+i*4]],'#fff1d42e',.7);box(c,413,333,587,7,trim);
  openBook(c,type==='cafe'?674:699,318,type==='blossom'?.88:.8);coffee(c,...cups[type],type==='cafe'?1:.8,type==='cafe'?'#f3e4cc':'#fff1df');
  if(type==='lavender'){
   box(c,546,268,30,45,'#b7b8aa',[8,8,10,10]);ellipse(c,561,270,15,4,'#cfcec0');for(let i=0;i<15;i++)lavenderSprig(c,556+noise(i)*10,270,30+noise(i+3)*31,(noise(i+16)-.5)*38,['#aa93bc','#c8b1d5','#9f8bb7'][i%3]);
   c.save();c.translate(924,309);c.rotate(.6);for(let i=0;i<7;i++)lavenderSprig(c,(i-3)*3,14,41+noise(i)*7,(i-3)*3,'#a591b5');c.restore();
  }else if(type==='blossom'){
   box(c,535,276,27,37,'#d5a7a3',[4,4,9,9]);for(let i=0;i<5;i++){const x=533+i*8,y=240+noise(i)*24;line(c,[[549,281],[x,y]],'#9a9779',1.1);flower(c,x,y,6+noise(i)*2,['#f9d4d7','#fff1e3','#ecbdc9'][i%3],i)}books(c,918,310,69);
  }else{
   box(c,879,293,52,29,'#ece0c7',1);line(c,[[906,296],[926,312]],'#b79b7c',1.1);ellipse(c,859,316,7,4,'#d1b78f');leafyPlant(c,969,318,.64,'#bb9778','#8aa785');
  }
 }
 function enrichOriginal(c,type,scene){
  if(scene===2){
   if(type==='stars')glow(c,742,65,142,'#dfc6dc14');
   if(type==='study')glow(c,716,185,188,'#e6b46a15');
   if(type==='wood')glow(c,780,144,177,'#ffda911a');
   if(type==='sea')glow(c,795,121,170,'#fff1c520');
   return;
  }
  if(type==='forest'){
   const s=scene===1;for(let i=0;i<27;i++){const x=442+noise(i+312)*548,y=298+noise(i+770)*39;
    if(x>675&&x<876)continue;line(c,[[x,y],[x-3,y-13]],'#9ebc77',1);flower(c,x-3,y-14,2+noise(i)*2,['#faecc3','#e5ddb0','#c5d996'][i%3]);
   }glow(c,s?763:674,103,148,'#f4edb921');
  }else if(type==='stars'){
   c.save();c.translate(666,79);c.rotate(-.38);for(let i=0;i<5;i++)ellipse(c,i*25,0,89,13+i*3,'#c7b9e005');c.restore();
   for(let i=0;i<11;i++){const x=526+noise(i+301)*391,y=44+noise(i+327)*113;glow(c,x,y,8,'#e4cabb19')}
  }else if(type==='sea'){
   if(scene===1){for(let i=0;i<13;i++){const x=803+noise(i+761)*183,y=294+noise(i+879)*40;ellipse(c,x,y,2.1,1.1,'#ffe8c18f',noise(i)*2)}glow(c,768,145,137,'#ffde9821')}
   else{for(let i=0;i<8;i++){const x=930+noise(i+6)*56,y=303+noise(i+81)*30;flower(c,x,y,2.5,'#f4e2c0')}}
  }else if(type==='snow'){
   for(let i=0;i<12;i++){const x=440+noise(i+70)*128,y=302+noise(i+48)*31;line(c,[[x,340],[x-3,y]],'#9a9a8066',.8);ellipse(c,x-4,y,2.2,2.2,'#b67c70');ellipse(c,x,y+4,2,2,'#c98b7b');ellipse(c,x-4,y-2,2.8,1.2,'#fff8e8')}
   glow(c,730,231,156,'#ffdf9c13');
  }else if(type==='wood'){
   for(let i=0;i<17;i++){const x=442+noise(i+310)*550,y=306+noise(i+12)*32;maple(c,x,y,2.4+noise(i)*3,noise(i)*6,['#c26847','#df9b57','#bd6148','#e0b971'][i%4])}
   glow(c,748,113,165,'#ffe1a922');
  }else if(type==='study'){
   if(scene===0){for(let j=0;j<17;j++){const x=671+noise(j+960)*187,y=310+noise(j+311)*27;line(c,[[x-5,y],[x+7,y]],'#eac99155',.9)}glow(c,755,229,156,'#f1c67810')}
   else{leafyPlant(c,930,327,.66,'#96744f','#708c66');glow(c,773,187,142,'#ffe2a016')}
  }
 }
 const outsideDrawers={forest,stars,sea,snow,wood:woodOutside,study:studyOutside,blossom:blossomLane,lavender:lavenderField,cafe:rainyGarden};
 const closeDrawers={forest:forestPath,stars:starTerrace,sea:seaShore,snow:snowPorch,wood:woodVeranda,study:studyWindow,blossom:blossomTerrace,lavender:lavenderGarden,cafe:cafeTerrace};
 function draw(){resizeDecorations();const rect=$('.world-art').getBoundingClientRect();if(!rect.width)return;const dpr=Math.min(devicePixelRatio||1,2);for(const cv of [base,fx]){cv.width=Math.round(rect.width*dpr);cv.height=Math.round(rect.height*dpr)}staticCanvas.width=1000;staticCanvas.height=340;if(state.scene===2){if(['blossom','lavender','cafe'].includes(state.theme))gardenRoom(paper,state.theme);else room(paper,state.theme)}else(state.scene===1?closeDrawers:outsideDrawers)[state.theme](paper);enrichOriginal(paper,state.theme,state.scene);for(let i=0;i<1800;i++){const x=noise(i+3000)*1000,y=noise(i+6000)*340;paper.fillStyle=i%2?'#ffffff06':'#10212005';paper.fillRect(x,y,1,1)}ctx.clearRect(0,0,base.width,base.height);ctx.drawImage(staticCanvas,0,0,base.width,base.height);anim.setTransform(fx.width/1000,0,0,fx.height/340,0,0);drawMotion(timeline)}
 function drawMotion(t){anim.clearRect(0,0,1000,340);const c=anim,s=state.strength,inside=state.scene===2,near=state.scene===1;
  const drift=inside?0:near?3:5;base.style.transform='translate('+(Math.sin(t*.26)*drift*s).toFixed(2)+'px,'+(Math.sin(t*.2)*drift*.33*s).toFixed(2)+'px) scale('+(inside?'1':'1.035')+')';
  $('.world-breathing-light').style.transform='translateX('+(Math.sin(t*.35)*4).toFixed(2)+'%)';
  const r=inside?roomWindow[state.theme]:{x:400,y:0,w:600,h:340};c.save();if(inside){windowShape(c,r);c.clip()}
  if(state.theme==='forest'){
   for(let i=0;i<(inside?10:25);i++){const x=r.x+noise(i+5)*r.w+Math.sin(t*.65+i)*17,y=r.y+r.h*.2+noise(i+32)*r.h*.72+Math.cos(t*.5+i*2)*12;c.globalAlpha=(.4+Math.sin(t*.85+i)*.25)*s;glow(c,x,y,inside?6:9,'#fff5a9af');ellipse(c,x,y,inside?1:1.6,inside?1:1.6,'#fff4b1')}c.globalAlpha=1;
   for(let i=0;i<(inside?4:7);i++){let x=r.x+((noise(i+700)*r.w+t*8)%r.w),y=r.y+(noise(i+42)*r.h+t*9)%r.h;ellipse(c,x+Math.sin(t*.7+i)*12,y,inside?3:4.5,1.7,'#cbd79da0',Math.sin(t*.8+i)*.9)}
   if(near)for(let j=0;j<8;j++){const x=856+j*14,y=265+j*3+Math.sin(t*.8+j);c.globalAlpha=.35*s;line(c,[[x,y],[x+9,y]],'#e1f0d9',1)}
  }else if(state.theme==='stars'){
   for(let i=0;i<(inside?17:28);i++){const x=r.x+noise(i+91)*r.w,y=r.y+12+noise(i+510)*r.h*.66;c.globalAlpha=(.3+Math.pow((Math.sin(t*.8+i)+1)/2,3)*.6)*s;glow(c,x,y,inside?6:10,'#e6d7b384');const d=inside?2:3.2;line(c,[[x-d,y],[x+d,y]],'#ead8aa',.8);line(c,[[x,y-d],[x,y+d]],'#ead8aa',.8)}c.globalAlpha=1;
   let u=(t+1)%13;if(u<2.4){c.globalAlpha=Math.sin(u/2.4*Math.PI)*.7*s;const x=r.x+r.w*(.25+u*.14),y=r.y+10+u*r.h*.065;line(c,[[x-24,y-9],[x,y]],'#ecdec0',1.1);glow(c,x,y,4,'#eee0c16a');c.globalAlpha=1}
   if(!inside&&!near){const angle=t*.16;c.save();c.translate(741,146);c.rotate(-.4);ellipse(c,Math.cos(angle)*117,Math.sin(angle)*69,2.3,2.3,'#dec48b');c.restore()}
  }else if(state.theme==='sea'){
   c.save();if(!inside&&near){c.beginPath();shoreline(c,-2);c.lineTo(1012,144);c.lineTo(-12,144);c.lineTo(-12,360);c.closePath();c.clip()}else if(!inside){c.beginPath();c.moveTo(395,181);c.lineTo(1000,181);c.lineTo(1000,238);c.bezierCurveTo(861,249,832,273,756,339);c.lineTo(395,340);c.closePath();c.clip()}
   const y0=inside?r.y+r.h*.55:near?154:190,step=inside?5:7,waterX=!inside&&near?-20:r.x,waterRight=r.x+r.w;for(let j=0;j<(!inside&&near?28:18);j++){const y=y0+j*step;c.beginPath();for(let x=waterX;x<=waterRight;x+=5){const dy=Math.sin(x*.036-t*1.1+j)*(inside?.8:1.8);if(x===waterX)c.moveTo(x,y+dy);else c.lineTo(x,y+dy)}c.strokeStyle=j%3?'#e8ebca42':'#fff1c569';c.lineWidth=1;c.globalAlpha=s*.8*(!inside&&near?Math.min(1,j/5):1);c.stroke()}c.globalAlpha=1;
   for(let i=0;i<17;i++){let x=r.x+r.w*.5+noise(i)*r.w*.2+Math.sin(t*.6+i)*4,y=y0+noise(i+91)*(inside?70:90);c.globalAlpha=(.2+Math.pow((Math.sin(t+i)+1)/2,5)*.55)*s;line(c,[[x-4,y],[x+4,y]],'#ffedd0',1.4)}c.globalAlpha=1;c.restore();
   if(!inside&&near){c.save();c.lineCap='round';for(let j=0;j<3;j++){c.beginPath();shoreline(c,-j*9-2+Math.sin(t*.7+j*.9)*2.4);c.strokeStyle='#fff4da';c.lineWidth=j?1:1.8;c.globalAlpha=s*(j?.17:.42);c.stroke()}c.restore()}
   if(!inside&&!near){c.save();c.translate(Math.sin(t*.24)*10,Math.sin(t*1.15)*2);poly(c,[[643,223],[663,223],[658,230],[647,230]],'#4f7370');line(c,[[654,222],[654,192]],'#716f5e',1);poly(c,[[652,194],[652,220],[636,220]],'#fff5d3');poly(c,[[656,202],[656,220],[669,220]],'#eac89c');c.restore()}
  }else if(state.theme==='snow'){
   for(let i=0;i<(inside?38:76);i++){const speed=inside?10+noise(i)*14:14+noise(i+25)*18,x=r.x+noise(i+76)*r.w+Math.sin(t*.5+i)*13,y=r.y+(noise(i+39)*(r.h+30)+t*speed)%(r.h+30)-15,sz=(inside?.8:1.1)+noise(i)*(inside?1.2:2);c.globalAlpha=(.42+noise(i+80)*.5)*s;ellipse(c,x,y,sz,sz,'#fffef5')}c.globalAlpha=1;
   if(!inside){const chimney=near?[822,48]:[779,135];for(let i=0;i<5;i++){const u=(t*.19+i/5)%1;c.globalAlpha=(1-u)*.2*s;ellipse(c,chimney[0]+Math.sin(u*4+t*.15)*9,chimney[1]-u*67,6+u*15,10+u*15,'#fffaf1',-.3)}}
  }else if(state.theme==='wood'){
   for(let i=0;i<(inside?9:16);i++){let depth=.55+noise(i+80)*.55, speed=(inside?12:18)*depth,x=r.x+noise(i+19)*r.w+Math.sin(t*.5+i)*22,y=r.y+(noise(i+44)*(r.h+50)+t*speed)%(r.h+50)-25;c.globalAlpha=(.56+noise(i)*.3)*s;c.save();c.translate(x,y);c.scale(.58+Math.abs(Math.sin(t*.7+i))*.42,1);maple(c,0,0,(inside?4.7:7)*depth,Math.sin(t*.6+i)*1.2+t*.12,['#a95339','#bd6544','#c48050','#a96240'][i%4]);c.restore()}c.globalAlpha=1;
   for(let i=0;i<8;i++){let x=r.x+noise(i+29)*r.w,y=r.y+noise(i+48)*r.h;c.globalAlpha=(.12+Math.sin(t*.4+i)*.08)*s;ellipse(c,x+Math.sin(t*.3+i)*7,y,1.4,1.4,'#ffeed0')}
  }else if(state.theme==='blossom'){
   for(let i=0;i<(inside?14:28);i++){
    const depth=.55+noise(i+614)*.6,speed=(inside?8:12)*depth,x=r.x+(noise(i+508)*r.w+t*(5+depth*2))%r.w+Math.sin(t*.65+i)*14,y=r.y+(noise(i+733)*(r.h+30)+t*speed)%(r.h+30)-15,sz=(inside?2.1:3.2)*depth;
    c.globalAlpha=(.48+depth*.3)*s;c.save();c.translate(x,y);c.rotate(t*.35+i);ellipse(c,0,0,sz,sz*.5,['#fff0e9','#f4c1cd','#fbe0df'][i%3]);line(c,[[-sz*.55,0],[sz*.5,0]],'#fff7ec8c',.45);c.restore();
   }c.globalAlpha=1;
   if(!inside){glow(c,725+Math.sin(t*.3)*9,113,86,'rgba(255,241,192,'+(.065+Math.sin(t*.55)*.02).toFixed(3)+')')}
  }else if(state.theme==='lavender'){
   if(!inside){
    c.save();c.globalAlpha=.92*s;for(let i=0;i<(near?16:21);i++){
     const x=454+noise(i+664)*528,y=(near?326:328)+noise(i+56)*12,h=14+noise(i+38)*25,lean=Math.sin(t*.8+i*.47)*(3+h*.06);
     lavenderSprig(c,x,y,h,lean,['#a894c0','#c1abd2','#d1bcde'][i%3]);
    }c.restore();
   }
   for(let i=0;i<(inside?5:10);i++){const x=r.x+noise(i+912)*r.w+Math.sin(t*.5+i)*13,y=r.y+r.h*.36+noise(i+61)*r.h*.52+Math.cos(t*.7+i)*8;c.globalAlpha=(.16+Math.pow((Math.sin(t*.6+i)+1)/2,3)*.34)*s;glow(c,x,y,4,'#fff0bb77');ellipse(c,x,y,1.1,1.1,'#fff3cf')}
   if(!inside){const bx=near?698:772,by=near?214:251,x=bx+Math.sin(t*.43)*25,y=by+Math.cos(t*.7)*9;c.globalAlpha=.68*s;ellipse(c,x,y,2.2,1.3,'#b1a068');ellipse(c,x-1,y-2,1.5,.7,'#fff1d3',Math.sin(t*12)*.7)}c.globalAlpha=1;
  }else if(state.theme==='cafe'){
   for(let i=0;i<(inside?43:63);i++){
    const speed=inside?30:48,x=r.x+noise(i+442)*r.w,y=r.y+(noise(i+311)*(r.h+24)+t*(speed+noise(i)*32))%(r.h+24)-12;
    c.globalAlpha=(.22+noise(i+12)*.18)*s;line(c,[[x,y],[x-2,y+(inside?8:11)]],'#f4f9ed',.8);
   }c.globalAlpha=1;
   if(inside){for(let i=0;i<12;i++){const x=r.x+13+noise(i+752)*(r.w-26),y=r.y+(noise(i+514)*r.h+t*(1.8+noise(i)*2))%r.h;c.globalAlpha=.33*s;line(c,[[x,y-7],[x-.6,y]],'#f7ffef',.7);ellipse(c,x-.6,y,1,1.6,'#f3f9e8a6')}c.globalAlpha=1}
   else{for(let i=0;i<7;i++){const u=(t*.39+i/7)%1,x=(near?595:703)+noise(i+139)*(near?309:166),y=307+noise(i+216)*27;c.beginPath();c.ellipse(x,y,2+u*10,.6+u*2.3,0,0,Math.PI*2);c.strokeStyle='#ecf3df';c.lineWidth=.65;c.globalAlpha=(1-u)*.4*s;c.stroke()}c.globalAlpha=1}
  }else if(state.theme==='study'){
   for(let i=0;i<(inside?49:76);i++){const speed=inside?53:88,x=r.x+noise(i+44)*r.w,y=r.y+(noise(i+73)*(r.h+25)+t*(speed+noise(i)*40))%(r.h+25)-12;c.globalAlpha=(inside?.21:.19+noise(i)*.12)*s;line(c,[[x,y],[x-3,y+(inside?9:13)]],'#dce2d4',.7)}c.globalAlpha=1;
   if(inside||near){const glass=inside?r:{x:658,y:38,w:232,h:237};c.save();windowShape(c,{...glass,r:inside?glass.r:78});c.clip();for(let i=0;i<13;i++){const x=glass.x+12+noise(i+70)*(glass.w-24),y=glass.y+(noise(i+31)*glass.h+t*(2+noise(i)*2))%glass.h;c.globalAlpha=.26*s;line(c,[[x,y-8],[x-1,y]],'#eef0dc',.9);ellipse(c,x-1,y,1.1,1.8,'#ecf0e399')}c.restore()}
  }
  c.globalAlpha=1;c.restore();
  if(inside){const trims={forest:'#776f4f',stars:'#998662',sea:'#b78d71',snow:'#b7986b',wood:'#92704f',study:'#ae9162',blossom:'#b59d82',lavender:'#acaa98',cafe:'#8ba18b'};line(c,[[r.x+r.w/2,r.y+7],[r.x+r.w/2,r.y+r.h]],trims[state.theme],5);line(c,[[r.x,r.y+r.h*.48],[r.x+r.w,r.y+r.h*.48]],trims[state.theme],4);
   const [cx,cy]=cups[state.theme];for(let i=0;i<3;i++){const u=(t*.2+i/3)%1,y=cy-22-u*52;c.beginPath();c.moveTo(cx-4+i*4,y+14);c.bezierCurveTo(cx-10+Math.sin(t+i)*3,y+4,cx+8+Math.sin(t+i)*3,y-5,cx+Math.sin(t*.5+i)*4,y-15);c.strokeStyle=state.theme==='study'||state.theme==='stars'?'#f6e0b585':'#fffcf4ce';c.globalAlpha=Math.sin(u*Math.PI)*.38*s;c.lineWidth=1.6;c.stroke()}c.globalAlpha=1;
   if(state.theme==='snow'){glow(c,927,263,52,'rgba(244,176,87,'+(.26+Math.sin(t*1.4)*.04).toFixed(3)+')');for(let i=0;i<3;i++){let x=907+i*16,h=25+Math.sin(t*2+i)*5;c.beginPath();c.moveTo(x-6,281);c.quadraticCurveTo(x-9,269,x+Math.sin(t*1.7+i)*4,281-h);c.quadraticCurveTo(x+9,274,x+6,281);c.fillStyle=['#d88944','#f2be63','#dca05a'][i];c.fill()}}
   if(state.theme==='study')glow(c,582,281,56,'rgba(249,209,131,'+(.13+Math.sin(t*.8)*.025).toFixed(3)+')');
  }
 drawDecorations(t);
 }

 function animate(now){if(!enabled||!state.motion||state.collapsed||!visible||document.hidden){frame=0;return}const active=document.activeElement;const editing=active&&(active.matches('input, textarea, select')||active.isContentEditable);if(now-lastFrame>(editing?80:40)){if(lastTick)timeline+=Math.min((now-lastTick)/1000,.1);lastTick=now;drawMotion(timeline);lastFrame=now}frame=requestAnimationFrame(animate)}
 function syncAnimation(){if(frame)cancelAnimationFrame(frame);frame=0;lastTick=0;const playing=enabled&&state.motion&&!state.collapsed&&visible&&!document.hidden;root.dataset.playing=String(playing);if(playing)frame=requestAnimationFrame(animate)}
 function render(){
  root.hidden=!enabled;
  if(sideLife)sideLife.hidden=!enabled||state.collapsed;
  root.dataset.theme=state.theme;root.dataset.scene=String(state.scene);root.dataset.view=state.page;root.dataset.collapsed=String(state.collapsed);
  if(!enabled){syncAnimation();return}
  const t=themes[state.theme],place=places[state.theme][state.scene];
  $('.world-eyebrow').textContent=t.eye;$('.world-title').textContent=place.title||t.title;$('.world-sub').textContent=place.sub||t.sub;
  $$('[data-world-scene]').forEach((button,i)=>{button.textContent='0'+(i+1)+' '+places[state.theme][i].name;button.setAttribute('aria-pressed',String(state.scene===i))});
  $('.world-enter').textContent=state.scene===2?'처음 풍경으로 ↗':'더 들어가기 →';
  $('.world-follow').checked=state.followPage;
  $('.world-motion').textContent=state.motion?'움직임 켜짐':'움직임 꺼짐';$('.world-motion').setAttribute('aria-pressed',String(state.motion));
  $('.world-collapse').textContent=state.collapsed?'배경 펼치기':'배경 접기';$('.world-collapse').setAttribute('aria-expanded',String(!state.collapsed));
  if(!state.collapsed)draw();syncAnimation();
 }
 function chooseScene(scene){state.scene=scene;sceneMemory[state.theme]=scene;persist();render();if(state.motion&&!reduce.matches&&!state.collapsed)base.animate([{opacity:.45},{opacity:1}],{duration:450,easing:'ease-out'})}
 function setTheme(theme){
  enabled=Object.prototype.hasOwnProperty.call(modes,theme.mode);
  if(enabled){state.theme=modes[theme.mode];document.body.dataset.worldTheme=state.theme;state.scene=state.followPage?(pagePlace[state.page]??0):([0,1,2].includes(sceneMemory[state.theme])?sceneMemory[state.theme]:0);const font=theme.font||(state.theme==='stars'||state.theme==='study'||state.theme==='snow'?"'Noto Serif KR', 'Batang', serif":"'Gowun Batang', 'Batang', serif");document.body.style.setProperty('--world-serif',font);window.appFonts?.ensureLoaded(font)}
  else{delete document.body.dataset.worldTheme;document.body.style.removeProperty('--world-serif')}
  render();
 }
 function setView(view){state.page=view;if(state.followPage)state.scene=pagePlace[view]??0;render()}
 $$('[data-world-scene]').forEach(button=>button.addEventListener('click',()=>chooseScene(Number(button.dataset.worldScene))));
 $('.world-enter').addEventListener('click',()=>chooseScene((state.scene+1)%3));
 $('.world-follow').addEventListener('change',event=>{state.followPage=event.target.checked;if(state.followPage)state.scene=pagePlace[state.page]??0;persist();render()});
 $('.world-motion').addEventListener('click',()=>{state.motion=!state.motion;persist();render()});
 $('.world-collapse').addEventListener('click',()=>{state.collapsed=!state.collapsed;persist();render()});
 document.addEventListener('visibilitychange',syncAnimation);
 reduce.addEventListener('change',event=>{if(event.matches){state.motion=false;render()}});
 const resize=new ResizeObserver(()=>{if(enabled&&!state.collapsed)draw()});resize.observe($('.world-art'));resize.observe($('.world-hero'));if(sideLife)resize.observe(sideLife);
 const intersection=new IntersectionObserver(entries=>{visible=entries[0].isIntersecting;syncAnimation()});intersection.observe($('.world-hero'));
 window.addEventListener('pagehide',()=>{if(frame)cancelAnimationFrame(frame);resize.disconnect();intersection.disconnect()},{once:true});
 window.journalWorlds={setTheme,setView};
})();

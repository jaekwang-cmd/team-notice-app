// Small, transparent illustrated worlds for the unused desktop sidebar space.
// The world renderer owns the canvas, DPR, visibility and animation clock.
(() => {
  'use strict';

  const TAU = Math.PI * 2;
  const aliases = {
    secretForest: 'forest', starObservatory: 'stars', sunsetLetter: 'sea',
    winterCabin: 'snow', nightStudy: 'study', cherryGarden: 'blossom',
    lavenderField: 'lavender', rainyCafe: 'cafe'
  };
  const palettes = {
    wood: { twig: '#8c6045', leaf: '#a85131', leaf2: '#cc7b42', leaf3: '#d59d5b', green: '#7e8250', glow: '#f6d486', fur: '#b9643e', cream: '#fff0cc' },
    forest: { twig: '#738062', leaf: '#658353', leaf2: '#8fa66a', leaf3: '#b6bd7f', green: '#52795c', glow: '#ddebad', fur: '#e9dbb9', cream: '#fff7dc' },
    blossom: { twig: '#99715e', leaf: '#879b6f', leaf2: '#c7798c', leaf3: '#f1b5bf', green: '#8f9d70', glow: '#ffd5c2', fur: '#8a9a8e', cream: '#fff5e4' },
    lavender: { twig: '#889077', leaf: '#899c7b', leaf2: '#8d77ae', leaf3: '#b39ac7', green: '#697f67', glow: '#e4d6f4', fur: '#b292a7', cream: '#fff1de' },
    cafe: { twig: '#8e7760', leaf: '#6b8c69', leaf2: '#92a578', leaf3: '#b6bd90', green: '#587b61', glow: '#e9cc94', fur: '#a07a5e', cream: '#fff0d6' },
    sea: { twig: '#ad8761', leaf: '#8b9c73', leaf2: '#ae775e', leaf3: '#d6a078', green: '#849e83', glow: '#fbd4ab', fur: '#dbab84', cream: '#fff5de' },
    snow: { twig: '#8a978d', leaf: '#719082', leaf2: '#97afa0', leaf3: '#c4d3c7', green: '#668a7d', glow: '#e7efe0', fur: '#c88459', cream: '#fff7e7' },
    study: { twig: '#a78e68', leaf: '#81926b', leaf2: '#ad8c5a', leaf3: '#c4b281', green: '#849878', glow: '#e9bd62', fur: '#bdb09a', cream: '#f8e9c5' },
    stars: { twig: '#9997b4', leaf: '#9694b3', leaf2: '#b3a9cc', leaf3: '#ddc69d', green: '#87999e', glow: '#d5c3ee', fur: '#b5a8aa', cream: '#f3e7c9' }
  };

  function oval(c, x, y, rx, ry, fill, angle = 0) {
    c.beginPath(); c.ellipse(x, y, rx, ry, angle, 0, TAU); c.fillStyle = fill; c.fill();
  }
  function line(c, points, color, width = 1) {
    c.beginPath(); c.moveTo(points[0], points[1]);
    for (let i = 2; i < points.length; i += 2) c.lineTo(points[i], points[i + 1]);
    c.strokeStyle = color; c.lineWidth = width; c.stroke();
  }
  function curve(c, x, y, a, b, d, e, f, g, color, width = 1) {
    c.beginPath(); c.moveTo(x, y); c.bezierCurveTo(a, b, d, e, f, g);
    c.strokeStyle = color; c.lineWidth = width; c.stroke();
  }
  function shape(c, points, fill) {
    c.beginPath(); c.moveTo(points[0], points[1]);
    for (let i = 2; i < points.length; i += 2) c.lineTo(points[i], points[i + 1]);
    c.closePath(); c.fillStyle = fill; c.fill();
  }
  function round(c, x, y, w, h, r, fill) {
    c.beginPath(); c.moveTo(x + r, y); c.lineTo(x + w - r, y);
    c.quadraticCurveTo(x + w, y, x + w, y + r); c.lineTo(x + w, y + h - r);
    c.quadraticCurveTo(x + w, y + h, x + w - r, y + h); c.lineTo(x + r, y + h);
    c.quadraticCurveTo(x, y + h, x, y + h - r); c.lineTo(x, y + r);
    c.quadraticCurveTo(x, y, x + r, y); c.fillStyle = fill; c.fill();
  }
  function glow(c, x, y, radius, color, opacity = .23) {
    c.save(); c.globalAlpha *= opacity;
    const g = c.createRadialGradient(x, y, 1, x, y, radius);
    g.addColorStop(0, color); g.addColorStop(1, color + '00');
    c.fillStyle = g; c.fillRect(x - radius, y - radius, radius * 2, radius * 2); c.restore();
  }
  function leaf(c, x, y, size, angle, color, vein = true) {
    c.save(); c.translate(x, y); c.rotate(angle);
    c.beginPath(); c.moveTo(0, 0); c.bezierCurveTo(-size * .64, -size * .4, -size * .5, -size * .95, 0, -size * 1.35);
    c.bezierCurveTo(size * .64, -size * .86, size * .49, -size * .3, 0, 0); c.fillStyle = color; c.fill();
    if (vein) { c.globalAlpha *= .2; line(c, [0, -2, 0, -size * 1.07], '#fff7da', .8); }
    c.restore();
  }
  function maple(c, x, y, size, angle, color) {
    c.save(); c.translate(x, y); c.rotate(angle);
    shape(c, [0, 2, -size * .25, -size * .17, -size * .73, -size * .19, -size * .54, -size * .49,
      -size * .92, -size * .82, -size * .4, -size * .7, -size * .28, -size * 1.11,
      -size * .06, -size * .85, size * .18, -size * 1.48, size * .39, -size * .89,
      size * .69, -size * 1.06, size * .62, -size * .66, size * 1.03, -size * .65,
      size * .63, -size * .27, size * .67, -size * .1, size * .22, -.3], color);
    c.globalAlpha *= .28; line(c, [0, 6, size * .16, -size * 1.08], '#fff0ca', .8); c.restore();
  }
  function blossom(c, x, y, size, color, center = '#c79857') {
    c.save(); c.translate(x, y);
    for (let k = 0; k < 5; k++) { const a = k * TAU / 5; oval(c, Math.cos(a) * size * .47, Math.sin(a) * size * .47, size * .51, size * .4, color, a); }
    oval(c, 0, 0, size * .15, size * .15, center); c.restore();
  }
  function frond(c, x, y, length, angle, color, t = 0) {
    c.save(); c.translate(x, y); c.rotate(angle + Math.sin(t) * .025);
    curve(c, 0, 0, -length * .06, -length * .36, length * .15, -length * .7, 0, -length, color, 1.2);
    for (let i = 1; i < 9; i++) {
      const q = i / 10, yy = -length * q, len = length * .23 * Math.sin(q * Math.PI);
      leaf(c, 2, yy, len, -1.05, color, false); leaf(c, 2, yy + 3, len, .99, color, false);
    }
    c.restore();
  }
  function grass(c, x, y, height, color, t, count = 7) {
    for (let k = 0; k < count; k++) {
      const a = k - count * .5, h = height * (.62 + .35 * Math.sin(k * 2.1 + 1.7) ** 2);
      const tip = x + a * 3.8 + Math.sin(t * .7 + k) * 1.5;
      curve(c, x + a * 1.8, y, x + a * 2.1, y - h * .48, tip, y - h * .76, tip, y - h, color, 1.05);
    }
  }
  function book(c, x, y, w, h, color, edge) {
    round(c, x, y, w, h, 2, color); round(c, x + 3, y + 2.5, w - 5, h - 5, 1, edge);
    c.save(); c.globalAlpha *= .2; line(c, [x + 6, y + h * .52, x + w - 6, y + h * .52], color, .8); c.restore();
    line(c, [x + 3, y + h - 1, x + w, y + h - 1], color, 1.5);
  }
  function sleepyEye(c, x, y, width, color) {
    c.beginPath(); c.moveTo(x - width / 2, y); c.quadraticCurveTo(x, y + width * .39, x + width / 2, y);
    c.strokeStyle = color; c.lineWidth = 1.1; c.stroke();
  }
  function fox(c, x, y, scale, p, t) {
    c.save(); c.translate(x, y); c.scale(scale, scale);
    oval(c, -1, 18, 37, 5, p.twig + '19');
    oval(c, 0, 1 + Math.sin(t * .85) * .55, 29, 20, p.fur, -.08);
    // The broad curled tail is part of the animal silhouette, with a pale brush tip.
    c.beginPath(); c.moveTo(-17, -4); c.bezierCurveTo(-49, -15, -43, 28, -10, 20);
    c.bezierCurveTo(6, 17, 13, 7 + Math.sin(t * .65), 19, 6);
    c.bezierCurveTo(4, 1, -8, 9, -17, -4); c.fillStyle = p.fur; c.fill();
    c.beginPath(); c.moveTo(-10, 20); c.bezierCurveTo(6, 17, 13, 7 + Math.sin(t * .65), 19, 6);
    c.bezierCurveTo(8, 2, 1, 6, -8, 6); c.lineTo(-1, 11); c.lineTo(-12, 13); c.closePath(); c.fillStyle = p.cream; c.fill();
    c.save(); c.translate(18, -11); c.rotate(.13);
    shape(c, [-17, -5, -17, -27, -3, -12], p.fur); shape(c, [4, -12, 17, -25, 16, -1], p.fur);
    shape(c, [-14, -8, -14, -21, -6, -12], p.twig); shape(c, [8, -11, 14, -20, 13, -5], p.twig);
    oval(c, 0, 0, 19, 15, p.fur);
    c.beginPath(); c.moveTo(-18, -2); c.quadraticCurveTo(-9, 5, 0, 4); c.quadraticCurveTo(10, 4, 18, -2);
    c.quadraticCurveTo(9, 15, 0, 16); c.quadraticCurveTo(-9, 12, -18, -2); c.fillStyle = p.cream; c.fill();
    sleepyEye(c, -8, -.5, 6, '#634b40'); sleepyEye(c, 8, -.5, 6, '#634b40');
    oval(c, 0, 7, 2.3, 1.7, '#634b40'); c.restore(); c.restore();
  }
  function cat(c, x, y, scale, p, t) {
    c.save(); c.translate(x, y); c.scale(scale, scale);
    oval(c, -3, 6 + Math.sin(t * .8) * .5, 30, 16, p.fur);
    c.beginPath(); c.moveTo(-26, 5); c.bezierCurveTo(-45, -6, -45, 21, -19, 18);
    c.bezierCurveTo(-12, 17, -13, 9 + Math.sin(t * .7), -21, 10); c.strokeStyle = p.fur; c.lineWidth = 9; c.stroke();
    oval(c, 22, 6, 17, 13, p.fur, .08);
    shape(c, [8, 0, 9, -17, 23, -4], p.fur); shape(c, [22, -4, 35, -16, 37, 6], p.fur);
    shape(c, [12, -2, 12, -11, 19, -4], '#a67e78'); shape(c, [26, -3, 32, -10, 34, 1], '#a67e78');
    oval(c, 22, 10, 9, 5, p.cream); sleepyEye(c, 15, 4, 5, '#645950'); sleepyEye(c, 28, 5, 5, '#645950');
    shape(c, [20, 8, 24, 8, 22, 11], '#947068');
    c.save(); c.globalAlpha *= .36;
    line(c, [6, 9, -1, 7], p.cream, .7); line(c, [6, 12, -2, 12], p.cream, .7);
    line(c, [37, 9, 44, 7], p.cream, .7); line(c, [37, 12, 44, 12], p.cream, .7); c.restore();
    oval(c, 10, 17, 8, 3, p.cream); c.restore();
  }
  function rabbit(c, x, y, scale, p, t) {
    c.save(); c.translate(x, y); c.scale(scale, scale);
    oval(c, 0, 19, 28, 4, p.twig + '19');
    oval(c, -5, 0 + Math.sin(t * .9) * .6, 22, 22, p.fur, -.1); oval(c, -25, 9, 8, 8, p.cream);
    const twitch = Math.sin(t * .5) * .035;
    oval(c, 9, -35, 5.5, 20, p.fur, -.17 + twitch); oval(c, 22, -31, 5, 19, p.fur, .2);
    oval(c, 9, -35, 2.6, 14.5, '#d5acaa', -.17 + twitch); oval(c, 22, -31, 2.2, 13, '#d5acaa', .2);
    oval(c, 13, -13, 16, 16, p.fur); oval(c, 20, -7, 9, 7, p.cream);
    oval(c, 21, -16, 1.5, 1.8, '#6a6455'); oval(c, 29, -9, 2.2, 1.6, '#b0887d');
    oval(c, 7, 17, 11, 4.6, p.cream); oval(c, 20, 12, 5, 4, p.cream); c.restore();
  }
  function bird(c, x, y, scale, color, cream, t, flip = false) {
    c.save(); c.translate(x, y); c.scale(flip ? -scale : scale, scale);
    line(c, [-4, 9, -4, 17, -8, 17], '#8f7960', .9); line(c, [4, 9, 4, 17, 8, 17], '#8f7960', .9);
    shape(c, [-10, 5, -28, -1, -20, 10, -7, 10], color);
    oval(c, 0, 0 + Math.sin(t * .85) * .35, 14, 11, color, -.1); oval(c, 7, -8, 9, 9, color);
    oval(c, 3, 3, 9, 7, cream, -.25); oval(c, -4, -1, 9, 5, color, -.35);
    shape(c, [14, -10, 23, -6, 15, -5], '#c49a58'); oval(c, 11, -10, 1.3, 1.4, '#514d43');
    c.save(); c.globalAlpha *= .45; curve(c, -11, 0, -6, 6, -3, 5, 2, 4, cream, 1); c.restore(); c.restore();
  }
  function butterfly(c, x, y, scale, color, t) {
    c.save(); c.translate(x, y); c.rotate(Math.sin(t * .6) * .12);
    const flap = .5 + Math.sin(t * 3.8) ** 2 * .5; c.scale(scale * flap, scale);
    oval(c, -5, -3, 5.5, 8, color, -.4); oval(c, 5, -3, 5.5, 8, color, .4);
    oval(c, -4, 5, 4.4, 5, color, .4); oval(c, 4, 5, 4.4, 5, color, -.4);
    c.restore(); line(c, [x, y - 4 * scale, x, y + 7 * scale], '#988574', .8);
  }
  function owl(c, x, y, scale, p, t) {
    c.save(); c.translate(x, y); c.scale(scale, scale);
    oval(c, 0, 4 + Math.sin(t * .8) * .45, 23, 29, p.fur);
    shape(c, [-21, -8, -23, -31, -7, -23, 7, -23, 23, -31, 21, -8], p.fur);
    oval(c, -10, -9, 12, 15, p.cream, -.12); oval(c, 10, -9, 12, 15, p.cream, .12);
    const blink = Math.sin(t * .31) > .991;
    if (blink) { sleepyEye(c, -9, -8, 7, '#736274'); sleepyEye(c, 9, -8, 7, '#736274'); }
    else { oval(c, -9, -8, 3.7, 5, '#736274'); oval(c, 9, -8, 3.7, 5, '#736274'); oval(c, -8, -10, 1, 1.3, p.cream); oval(c, 10, -10, 1, 1.3, p.cream); }
    shape(c, [-3, -3, 3, -3, 0, 3], '#d1a669');
    for (let i = 0; i < 3; i++) { sleepyEye(c, -7 + i * 7, 13, 4, p.cream); sleepyEye(c, -4 + i * 5, 20, 3, p.cream); }
    oval(c, -18, 7, 6, 18, p.twig, -.16); oval(c, 18, 7, 6, 18, p.twig, .16);
    line(c, [-10, 30, -10, 34, -6, 34], '#d1a669', 2); line(c, [8, 30, 8, 34, 12, 34], '#d1a669', 2); c.restore();
  }
  function pine(c, x, y, height, p, alpha = 1) {
    c.save(); c.globalAlpha *= alpha;
    line(c, [x, y, x, y - height], p.twig, 2.2);
    for (let k = 0; k < 5; k++) {
      const q = (k + 1) / 6, yy = y - height + q * height;
      shape(c, [x, yy - height * .22, x - height * q * .33, yy + 5, x - 3, yy - 2,
        x + height * q * .34, yy + 6], k % 2 ? p.leaf : p.green);
      shape(c, [x, yy - height * .22, x - height * q * .2, yy - height * .04, x, yy - height * .08,
        x + height * q * .23, yy - height * .025], '#f2f3e7');
    }
    c.restore();
  }
  function vine(c, x, y, length, direction, p, t, flowers = false) {
    c.save();
    const bend = 9 * direction, sway = Math.sin(t * .65) * 2;
    curve(c, x, y, x + 18 * direction, y + length * .35, x - bend, y + length * .66, x + bend + sway, y + length, p.twig, 1.3);
    for (let i = 1; i <= 9; i++) {
      const q = i / 10, yy = y + q * length;
      const xx = x + Math.sin(q * Math.PI * 2) * bend + q * sway, side = i % 2 ? 1 : -1;
      leaf(c, xx, yy, 8 + Math.sin(i * 2) * 2, side * 1.7 + Math.sin(t * .6 + i) * .04, i % 3 ? p.leaf : p.leaf2);
      if (flowers && i % 3 === 0) blossom(c, xx + side * 14, yy + 7, 4.5, p.cream);
    }
    c.restore();
  }
  function branch(c, h, p, t, floral = false) {
    const y = h * .14;
    curve(c, -12, y - 5, 38, y + 10, 97, y + 72, 157, y + 52, p.twig, 3.1);
    curve(c, 44, y + 24, 71, y + 20, 111, y - 6, 148, y + 3, p.twig, 1.8);
    curve(c, 83, y + 43, 115, y + 31, 163, y + 37, 200, y + 12, p.twig, 1.3);
    for (let i = 0; i < 24; i++) {
      const xx = 19 + ((i * 43) % 177), yy = y + 1 + (i * 29) % 71;
      const s = 7 + (i * 7) % 9, angle = ((i * 2.3) % 5) - 2.5 + Math.sin(t * .7 + i * .8) * .065;
      const color = i % 3 === 0 ? p.leaf2 : i % 3 === 1 ? p.leaf3 : p.leaf;
      if (floral) { leaf(c, xx, yy + 2, s * .78, angle, p.leaf); blossom(c, xx + 5, yy - 3, s * .69, i % 3 ? '#efb6c2' : '#ffe0e3'); }
      else maple(c, xx, yy, s, angle, color);
    }
  }
  function drift(c, w, h, t, color, type, count = 5) {
    c.save(); c.globalAlpha *= .67;
    for (let i = 0; i < count; i++) {
      const yy = ((i * 79 + t * (3.5 + i * .23)) % (h + 25)) - 12;
      const xx = 25 + ((i * 47) % (w - 38)) + Math.sin(t * .35 + i * 1.9) * 10;
      if (type === 'leaf') maple(c, xx, yy, 3.4 + i % 3, Math.sin(t * .6 + i) * .8, color);
      else if (type === 'petal') oval(c, xx, yy, 2.8, 1.5, color, t * .25 + i);
      else oval(c, xx, yy, 1.2 + (i % 3) * .3, 1.2 + (i % 3) * .3, color);
    }
    c.restore();
  }

  function wood(c, h, p, t) {
    glow(c, 104, h * .36, 104, p.glow, .19); branch(c, h, p, t);
    if (h > 255) {
      const y = h * .45;
      curve(c, 212, y - 43, 167, y - 22, 164, y + 30, 127, y + 52, p.twig, 1.7);
      for (let i = 0; i < 12; i++) {
        const xx = 195 - i * 5.3 + Math.sin(i * 2) * 9, yy = y - 25 + i * 6.5;
        maple(c, xx, yy, 7 + (i % 3) * 2.5, .5 + Math.sin(t * .6 + i) * .11, i % 3 ? p.leaf2 : p.leaf);
      }
    }
    c.save(); c.globalAlpha = .24;
    curve(c, -4, h - 22, 59, h - 44, 123, h - 9, 204, h - 29, p.twig, 1); c.restore();
    grass(c, 33, h - 21, 31, p.green, t); grass(c, 165, h - 22, 44, p.green, t + 1);
    fox(c, 100, h - 44, .86, p, t);
    maple(c, 34, h - 9, 8, -1.3, p.leaf); maple(c, 150, h - 9, 7, 1.2, p.leaf2);
    drift(c, 200, h, t, p.leaf2, 'leaf', 4);
  }
  function forest(c, h, p, t) {
    glow(c, 119, h * .41, 115, p.glow, .25);
    vine(c, 29, -28, Math.min(h * .66, 225), 1, p, t);
    vine(c, 178, -47, Math.min(h * .52, 175), -1, p, t + 2, true);
    c.save(); c.globalAlpha *= .46; frond(c, 5, h - 20, 113, .39, p.leaf2, t); frond(c, 182, h - 16, 100, -.45, p.leaf2, t + 2); c.restore();
    rabbit(c, 109, h - 39, .83, p, t);
    frond(c, 17, h - 4, 76, -.35, p.green, t); frond(c, 178, h - 4, 66, .19, p.green, t + 1);
    for (let i = 0; i < 6; i++) {
      const xx = 32 + i * 27, yy = h - 14 - Math.sin(i * 1.7) ** 2 * 10;
      line(c, [xx, h - 3, xx + 2, yy - 10], p.green, .8); blossom(c, xx + 2, yy - 11, 3.5, i % 2 ? '#e5c6b0' : '#f5edc6');
    }
    butterfly(c, 125 + Math.sin(t * .22) * 14, h * .4 + Math.cos(t * .32) * 6, .62, '#d4b571', t);
  }
  function blossomWorld(c, h, p, t) {
    glow(c, 103, h * .3, 115, p.glow, .25); branch(c, h, p, t, true);
    if (h > 255) {
      const y = h * .38;
      curve(c, 205, y - 29, 159, y - 20, 184, y + 54, 151, y + 89, p.twig, 1.35);
      for (let i = 0; i < 14; i++) {
        const x = 190 - i * 2.5 + Math.sin(i * 3) * 8, yy = y - 12 + i * 7;
        leaf(c, x, yy, 6, -.7 + Math.sin(i) * 1.8, p.leaf);
        blossom(c, x - 5, yy + 1, 6.3 + i % 2, i % 3 ? '#efb6c2' : '#ffe0e3');
      }
    }
    curve(c, -10, h - 63, 65, h - 32, 130, h - 67, 207, h - 54, p.twig, 2.2);
    bird(c, 118, h - 71, .88, p.fur, p.cream, t, true);
    for (let i = 0; i < 9; i++) {
      const x = 10 + i * 23, y = h - 54 + Math.sin(i * 1.8) * 8;
      leaf(c, x, y, 8, i % 2 ? -.8 : 2.1, p.leaf); blossom(c, x + 7, y - 5, 6.1, i % 2 ? '#f5c5cb' : '#e9a6b7');
    }
    grass(c, 25, h - 8, 28, p.leaf, t); grass(c, 170, h - 8, 31, p.leaf, t + 1);
    drift(c, 200, h, t, '#df91a5', 'petal', 7);
  }
  function lavender(c, h, p, t) {
    glow(c, 98, h * .49, 119, p.glow, .32);
    for (let i = 0; i < 22; i++) {
      const x = 7 + i * 9, length = 37 + ((i * 31) % 65) + (h > 255 && (i < 5 || i > 17) ? (h - 230) * .6 : 0), y = h - 13 + Math.sin(i * 1.9) * 8;
      const sway = Math.sin(t * .65 + i * .4) * 2.8, lean = (x - 100) * .11;
      curve(c, x, y, x + lean * .2, y - length * .35, x + lean + sway, y - length * .7, x + lean + sway, y - length, p.green, 1.2);
      leaf(c, x + lean * .25, y - length * .3, 10, -1.1, p.leaf, false); leaf(c, x + lean * .55, y - length * .5, 9, .8, p.leaf, false);
      for (let k = 0; k < 7; k++) {
        const xx = x + lean + sway + (k % 2 ? 2.2 : -2.2), yy = y - length + k * 3.3;
        oval(c, xx, yy, 2.8 - k * .06, 3.3, i % 3 ? p.leaf2 : p.leaf3, k % 2 ? .6 : -.6);
      }
    }
    const py = Math.max(39, h * .23);
    butterfly(c, 89 + Math.sin(t * .23) * 18, py + Math.cos(t * .34) * 6, .97, '#c3a2c8', t);
    butterfly(c, 151 + Math.sin(t * .3 + 3) * 11, h * .43 + Math.sin(t * .4) * 5, .68, '#d3b382', t + 1.8);
    c.save(); c.globalAlpha *= .34;
    curve(c, -5, h - 7, 49, h - 11, 101, h - 3, 208, h - 8, p.green, 1); c.restore();
  }
  function cafe(c, h, p, t) {
    glow(c, 101, h * .53, 114, p.glow, .25);
    vine(c, 20, -28, Math.min(h * .79, 249), 1, p, t); vine(c, 178, -39, Math.min(h * .55, 160), -1, p, t + 2);
    const y = h - 53;
    book(c, 49, y + 30, 105, 12, '#a8a18a', p.cream); book(c, 58, y + 20, 97, 12, '#b3947a', p.cream);
    oval(c, 105, y + 18, 36, 4, '#b29c7b'); oval(c, 105, y + 17, 32, 3, p.cream);
    c.beginPath(); c.moveTo(80, y - 18); c.lineTo(84, y + 5); c.quadraticCurveTo(86, y + 19, 105, y + 19);
    c.quadraticCurveTo(123, y + 19, 125, y + 5); c.lineTo(129, y - 18); c.closePath(); c.fillStyle = '#c1a183'; c.fill();
    c.beginPath(); c.ellipse(131, y - 4, 11, 10, -.2, -1.6, 1.6); c.strokeStyle = '#c1a183'; c.lineWidth = 4; c.stroke();
    oval(c, 104.5, y - 18, 24.5, 4.7, p.cream); oval(c, 104.5, y - 17.5, 20.5, 3, '#80614c');
    c.save(); c.globalAlpha *= .46;
    for (let k = 0; k < 3; k++) {
      const sx = 92 + k * 11, wave = Math.sin(t * .65 + k) * 4;
      curve(c, sx, y - 28, sx - 7 + wave, y - 39, sx + 7 + wave, y - 49, sx + wave, y - 64, '#fff5da', 1.6);
    }
    c.restore();
    bird(c, 147, Math.max(43, y - 104), .66, p.fur, p.cream, t + 1);
    curve(c, 124, Math.max(60, y - 87), 160, Math.max(64, y - 79), 179, Math.max(48, y - 94), 207, Math.max(51, y - 87), p.twig, 1.8);
    leaf(c, 161, Math.max(62, y - 85), 10, 2.1, p.leaf);
  }
  function sea(c, h, p, t) {
    glow(c, 98, h * .29, 108, p.glow, .28);
    c.save(); c.globalAlpha *= .45;
    for (let i = 0; i < 5; i++) {
      const y = h - 48 + i * 9, sx = Math.sin(t * .45 + i) * 4;
      curve(c, 10, y, 56 + sx, y - 6, 114, y + 5, 194, y - 4, '#7caba3', .95);
    }
    c.restore();
    const y = h - 49;
    shape(c, [78, y, 89, y - 105, 114, y - 105, 126, y], '#f5e3c0');
    shape(c, [89, y - 105, 114, y - 105, 116, y - 86, 87, y - 86], '#b9775e');
    shape(c, [84, y - 61, 119, y - 61, 121, y - 44, 82, y - 44], '#b9775e');
    round(c, 96, y - 25, 11, 25, 5, '#928c73');
    round(c, 89, y - 123, 25, 19, 2, '#b6a688'); round(c, 93, y - 120, 17, 13, 1, '#ffe1a0');
    line(c, [101.5, y - 120, 101.5, y - 107], '#a58d6f', 1);
    shape(c, [84, y - 123, 101.5, y - 137, 120, y - 123], '#849e88');
    glow(c, 101, y - 114, 26, '#ffe1a0', .3);
    for (let i = 0; i < 3; i++) {
      const x = 43 + i * 52 + Math.sin(t * .25 + i) * 8, yy = Math.max(27, h * .2) + i * 14;
      const flap = Math.sin(t * 1.3 + i) * 2;
      c.beginPath(); c.moveTo(x - 8, yy - 3 - flap); c.quadraticCurveTo(x - 3, yy - 4, x, yy);
      c.quadraticCurveTo(x + 4, yy - 4, x + 9, yy - 3 + flap); c.strokeStyle = '#8fa6a0'; c.lineWidth = 1.2; c.stroke();
    }
    grass(c, 31, h - 10, 57, p.green, t); grass(c, 163, h - 9, 71, p.green, t + 2);
    for (let i = 0; i < 4; i++) oval(c, 57 + i * 29, h - 11 + Math.sin(i * 2) * 3, 4 + i % 2, 2, '#c7b799', -.3);
  }
  function snow(c, h, p, t) {
    glow(c, 100, h * .35, 120, p.glow, .3);
    pine(c, 50, h - 45, Math.min(h - 22, 188), p, .5); pine(c, 160, h - 28, Math.min(h - 15, 147), p, .74);
    c.save(); c.globalAlpha *= .66;
    oval(c, 101, h - 22, 83, 12, '#eff3e8'); oval(c, 151, h - 17, 49, 9, '#f9f8ec'); c.restore();
    fox(c, 104, h - 44, .78, p, t);
    grass(c, 31, h - 16, 29, p.twig, t, 5); grass(c, 171, h - 11, 22, p.twig, t + 1, 4);
    drift(c, 200, h, t, '#f8fbef', 'snow', 11);
  }
  function study(c, h, p, t) {
    glow(c, 101, h * .4, 104, p.glow, .18);
    vine(c, 179, -45, Math.min(h * .56, 191), -1, p, t);
    const y = h - 21;
    book(c, 32, y, 133, 14, '#9d8c66', '#eadcba'); book(c, 43, y - 14, 111, 16, '#6c8169', '#e9ddbd');
    book(c, 36, y - 26, 117, 13, '#b69766', '#efe2c1'); cat(c, 100, y - 45, .91, p, t);
    const ly = Math.max(29, h * .18);
    c.save(); c.globalAlpha *= .77;
    line(c, [35, -5, 35, ly], '#c3af87', 1.1); shape(c, [19, ly + 17, 28, ly, 43, ly, 53, ly + 17], '#c8ae73');
    oval(c, 36, ly + 17, 17, 3.5, '#f2d78d'); c.restore(); glow(c, 36, ly + 24, 43, '#efce7c', .23);
    for (let i = 0; i < 4; i++) {
      c.save(); c.globalAlpha *= .15 + Math.sin(t * .65 + i) ** 2 * .13;
      oval(c, 71 + i * 29, h * .37 + Math.sin(t * .2 + i) * 10 + i * 13, 1, 1, '#ffe0a0'); c.restore();
    }
  }
  function stars(c, h, p, t) {
    const my = Math.max(34, h * .17);
    glow(c, 76, my + 2, 68, p.glow, .16);
    c.beginPath(); c.moveTo(83, my - 23); c.bezierCurveTo(52, my - 26, 49, my + 22, 82, my + 24);
    c.bezierCurveTo(67, my + 12, 66, my - 10, 83, my - 23); c.fillStyle = '#e9d4a8'; c.fill();
    for (let i = 0; i < 15; i++) {
      const x = 18 + (i * 43) % 168, y = 14 + (i * 53) % Math.max(40, h - 120);
      const size = i % 4 === 0 ? 3.1 : 1.3;
      c.save(); c.globalAlpha *= .25 + Math.sin(t * .5 + i * 1.7) ** 2 * .5;
      if (size > 2) { shape(c, [x, y - size, x + .8, y - .8, x + size, y, x + .8, y + .8, x, y + size, x - .8, y + .8, x - size, y, x - .8, y - .8], '#ead9be'); }
      else oval(c, x, y, size * .65, size * .65, '#dfd4ec'); c.restore();
    }
    const by = h - 24;
    curve(c, -9, by + 6, 51, by - 10, 128, by + 6, 212, by - 19, p.twig, 2.8);
    curve(c, 158, by - 7, 175, by - 24, 173, by - 43, 187, by - 54, p.twig, 1.4);
    for (let i = 0; i < 7; i++) {
      const x = 18 + i * 27, y = by - 1 - Math.sin(i * 1.8) * 8;
      leaf(c, x, y, 7, i % 2 ? 2.3 : -.4, i % 2 ? p.leaf : p.leaf2);
    }
    owl(c, 108, by - 30, .82, p, t);
  }

  const painters = { wood, forest, blossom: blossomWorld, lavender, cafe, sea, snow, study, stars };
  function draw(ctx, width, height, theme, scene, time) {
    if (!ctx || !Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return;
    const key = aliases[theme] || theme;
    const p = palettes[key] || palettes.wood;
    const paint = painters[key] || painters.wood;
    const t = (Number.isFinite(time) ? time : 0) + (Number.isFinite(scene) ? scene * .73 : 0);
    ctx.save();
    ctx.clearRect(0, 0, width, height);
    ctx.beginPath(); ctx.rect(0, 0, width, height); ctx.clip();
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    // A fixed illustration width keeps details legible; flexible height grows the garden.
    const scale = width / 200;
    ctx.scale(scale, scale);
    const h = height / scale;
    if (h < 220) {
      const compact = h / 220;
      ctx.translate(100 * (1 - compact), 0);
      ctx.scale(compact, compact);
      paint(ctx, 220, p, t);
    } else paint(ctx, h, p, t);
    ctx.restore();
  }
  window.storybookSidebar = Object.freeze({ draw });
})();

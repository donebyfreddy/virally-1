# -*- coding: utf-8 -*-
"""Genera reels 9:16 a partir de la entrevista: cortes cada ~3s segun quien habla,
subtitulos animados palabra a palabra, hook inicial y whooshes en cada corte."""
import os, sys, json, math, subprocess, wave, struct
import numpy as np
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from old.clips import CLIPS

SRC = "/sessions/friendly-awesome-cray/mnt/ai-video-creatoer/The FULL Andrew Tate BBC Interview.mp4"
WORK = "/tmp/work"
OUT = "/sessions/friendly-awesome-cray/mnt/ai-video-creatoer/reels"
os.makedirs(WORK, exist_ok=True); os.makedirs(OUT, exist_ok=True)

FPS = 30
CW, CH = 1080, 1920          # lienzo vertical
ACT_Y, ACT_H = 47, 209       # zona util del fuente (sin letterbox ni subs quemados)
SEG = 3.0                    # duracion objetivo de cada corte
BOX_CY = 850                 # centro vertical del recuadro de video

# encuadres: (nombre, ancho_crop, x_crop)
FR = {
    "wide":  (640,   0),
    "two":   (520,  60),
    "tate":  (250, 390),
    "tateM": (330, 310),
    "lucy":  (240,   0),
    "lucyM": (330,   0),
}

def run(cmd):
    p = subprocess.run(cmd, shell=True, capture_output=True, text=True)
    if p.returncode != 0:
        raise RuntimeError(cmd[:400] + "\n" + p.stderr[-2500:])
    return p.stdout

# ---------------------------------------------------------------- movimiento
_MO = None
def motion(t0, t1):
    """Devuelve (energia_izq, energia_der) del movimiento en la ventana dada."""
    global _MO
    if _MO is None:
        _MO = np.load("/tmp/mo.npy", mmap_mode="r")
    a = int(t0 * FPS); b = min(int(t1 * FPS), len(_MO) - 1)
    if b - a < 3: return (0.0, 0.0)
    blk = np.asarray(_MO[a:b:2], dtype=np.int16)
    d = np.abs(np.diff(blk, axis=0))
    return (float(d[:, :, 0:22].mean()), float(d[:, :, 42:64].mean()))

def plan(clip):
    """Trocea el clip en cortes de ~SEG s y asigna encuadre segun quien habla."""
    t0, t1 = clip["start"], clip["end"]
    subs = clip["subs"]
    starts = [s[0] for s in subs]

    # 1. bordes cada SEG s, ajustados al inicio de subtitulo mas cercano
    n = max(1, round((t1 - t0) / SEG))
    edges = [t0]
    for i in range(1, n):
        want = t0 + (t1 - t0) * i / n
        cand = [s for s in starts if abs(s - want) <= 0.7 and s > edges[-1] + 1.2]
        edges.append(min(cand, key=lambda s: abs(s - want)) if cand else want)
    edges.append(t1)

    # 2. hablante dominante de cada corte
    who = []
    for i in range(len(edges) - 1):
        a, b = edges[i], edges[i + 1]
        acc = {"L": 0.0, "T": 0.0}
        for ss, se, _, sp in subs:
            ov = min(b, se) - max(a, ss)
            if ov > 0: acc[sp] += ov
        tot = acc["L"] + acc["T"]
        who.append("X" if tot <= 0 or max(acc.values()) / tot < 0.65
                   else ("T" if acc["T"] > acc["L"] else "L"))

    # 3. encuadre: alterna dentro del hablante e inserta reaccion en monologos
    CYC = {"T": ["tate", "tateM", "tate", "two"], "L": ["lucy", "lucyM", "lucy", "two"],
           "X": ["two", "wide", "two", "wide"]}
    REACT = {"T": "lucy", "L": "tate", "X": "wide"}
    segs, prev, run_len, run_spk = [], None, 0, None
    for i, (a, b) in enumerate(zip(edges, edges[1:])):
        sp = who[i]
        run_len = run_len + 1 if sp == run_spk else 1
        run_spk = sp
        f = "wide" if i == 0 else (
            REACT[sp] if run_len % 4 == 0 else CYC[sp][run_len % len(CYC[sp])])
        if f == prev:
            f = {"tate": "tateM", "tateM": "tate", "lucy": "lucyM",
                 "lucyM": "lucy", "two": "wide", "wide": "two"}[f]
        segs.append((a, b, f)); prev = f
    return segs

# ---------------------------------------------------------------- subtitulos
def esc(s):
    return s.replace("\\", "\\\\").replace("{", "(").replace("}", ")")

FONT_PATH = "/usr/share/fonts/truetype/lato/Lato-Black.ttf"
FONT_SIZE = 66
MAXW = 880              # ancho maximo de linea en px (1080 - margenes - holgura)
MAXLINES = 2
_FONT = None

def tw(s):
    """Ancho en px del texto con la fuente real de los subtitulos."""
    global _FONT
    if _FONT is None:
        from PIL import ImageFont
        _FONT = ImageFont.truetype(FONT_PATH, FONT_SIZE)
    return _FONT.getlength(s)

def split_caption(words):
    """Parte una frase en trozos que caben en MAXLINES lineas de MAXW px."""
    chunks, cur = [], []
    for w in words:
        cand = cur + [w]
        if cur and not fits(cand):
            chunks.append(cur); cur = [w]
        else:
            cur.append(w)
    if cur: chunks.append(cur)
    return chunks

def fits(words):
    lines = wrap(words, nmax=MAXLINES)
    return len(lines) <= MAXLINES and all(tw(" ".join(l)) <= MAXW for l in lines)

def wrap(words, nmax=2):
    """Reparte en lineas equilibradas por ancho real (evita huerfanas)."""
    total = tw(" ".join(words))
    n = min(nmax, max(1, math.ceil(total / MAXW)))
    if n == 1: return [words]
    best, best_cost = None, None
    # prueba todos los puntos de corte y elige el reparto mas equilibrado
    def splits(k):
        if k == 1:
            yield []
            return
        for cuts in splits(k - 1):
            start = (cuts[-1] if cuts else 0) + 1
            for c in range(start, len(words)):
                yield cuts + [c]
    for cuts in splits(n):
        parts = []
        prev = 0
        for c in cuts + [len(words)]:
            parts.append(words[prev:c]); prev = c
        if any(not p for p in parts): continue
        lens = [tw(" ".join(p)) for p in parts]
        cost = max(lens) * 100 + (max(lens) - min(lens))
        if best_cost is None or cost < best_cost:
            best, best_cost = parts, cost
    return best or [words]

def ts(t):
    cs = int(round(t * 100)); h = cs // 360000; m = (cs % 360000) // 6000
    s = (cs % 6000) // 100; c = cs % 100
    return "%d:%02d:%02d.%02d" % (h, m, s, c)

ASS_HEAD = """[Script Info]
ScriptType: v4.00+
PlayResX: 1080
PlayResY: 1920
WrapStyle: 2
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name,Fontname,Fontsize,PrimaryColour,SecondaryColour,OutlineColour,BackColour,Bold,Italic,Underline,StrikeOut,ScaleX,ScaleY,Spacing,Angle,BorderStyle,Outline,Shadow,Alignment,MarginL,MarginR,MarginV,Encoding
Style: Sub,Lato Black,66,&H00FFFFFF,&H00FFFFFF,&H00101010,&H90000000,-1,0,0,0,100,100,0.6,0,1,7,3,2,70,70,320,1
Style: Hook,Lato Black,74,&H00FFFFFF,&H00FFFFFF,&H23101010,&H00000000,-1,0,0,0,100,100,0.5,0,3,20,0,8,90,90,230,1

[Events]
Format: Layer,Start,End,Style,Name,MarginL,MarginR,MarginV,Effect,Text
"""

HL = "&H0020E6FF"   # amarillo/ambar para la palabra activa (formato ABGR de ASS)

def make_ass(clip, path):
    t0 = clip["start"]
    ev = []
    # hook de entrada
    hook = clip["hook"].replace("{", "(").replace("}", ")")   # \N se conserva
    ev.append("Dialogue: 0,%s,%s,Hook,,0,0,0,,{\\fad(140,260)}%s"
              % (ts(0.15), ts(3.15), hook))
    groups = []
    for a, b, text, _spk in clip["subs"]:
        a -= t0; b -= t0
        if b <= 0: continue
        a = max(a, 0.0)
        chunks = split_caption(esc(text).split())
        cl = np.array([len(" ".join(c)) for c in chunks], dtype=float)
        cb = np.concatenate(([a], a + np.cumsum(cl / cl.sum() * (b - a))))
        for j, ch in enumerate(chunks):
            groups.append((cb[j], cb[j + 1], ch))

    for a, b, words in groups:
        lines = wrap(words)
        flat = [w for ln in lines for w in ln]
        # reparto proporcional a la longitud de cada palabra
        wt = np.array([max(len(w), 2) for w in flat], dtype=float)
        wt = wt / wt.sum() * (b - a)
        bounds = np.concatenate(([a], a + np.cumsum(wt)))
        k = 0
        for gi in range(len(flat)):
            parts, idx = [], 0
            for ln in lines:
                seg = []
                for w in ln:
                    if idx == gi:
                        seg.append("{\\c%s\\fscx108\\fscy108}%s{\\c&H00FFFFFF&\\fscx100\\fscy100}" % (HL, w))
                    else:
                        seg.append(w)
                    idx += 1
                parts.append(" ".join(seg))
            body = "\\N".join(parts)
            s, e = bounds[gi], bounds[gi + 1]
            if e - s < 0.06: e = s + 0.06
            fx = "{\\fad(60,0)}" if gi == 0 else ""
            ev.append("Dialogue: 1,%s,%s,Sub,,0,0,0,,%s%s" % (ts(s), ts(e), fx, body))
            k += 1
    open(path, "w").write(ASS_HEAD + "\n".join(ev) + "\n")

# ---------------------------------------------------------------- whooshes
def whoosh_track(cuts, dur, path, sr=44100):
    n = int(dur * sr) + sr
    track = np.zeros(n, dtype=np.float32)
    rng = np.random.default_rng(7)
    L = int(0.30 * sr)
    t = np.arange(L) / sr
    for c in cuts:
        noise = rng.standard_normal(L).astype(np.float32)
        # filtrado paso-banda suave via FFT (barrido descendente aproximado)
        F = np.fft.rfft(noise)
        f = np.fft.rfftfreq(L, 1 / sr)
        band = np.exp(-((f - 1500.0) ** 2) / (2 * 900.0 ** 2))
        noise = np.fft.irfft(F * band, L).astype(np.float32)
        env = np.exp(-t * 13.0) * (1 - np.exp(-t * 400.0))
        thump = 0.35 * np.sin(2 * np.pi * 70 * t) * np.exp(-t * 22.0)
        sig = (noise / (np.abs(noise).max() + 1e-9) * env + thump) * 0.085
        i = int(c * sr)
        if i + L < n: track[i:i + L] += sig
    track = np.clip(track, -1, 1)
    st = np.stack([track, track], axis=1).reshape(-1)
    with wave.open(path, "wb") as w:
        w.setnchannels(2); w.setsampwidth(2); w.setframerate(sr)
        w.writeframes((st * 32767).astype("<i2").tobytes())

# ---------------------------------------------------------------- render
def seg_video(a, b, fr, out, idx):
    w, x = FR[fr]
    bw = CW
    bh = int(round(CW * ACT_H / w / 2)) * 2
    dur = b - a
    nf = max(2, int(round(dur * FPS)))
    z0, z1 = (1.0, 1.06) if idx % 2 == 0 else (1.06, 1.0)
    zexpr = "%.4f+(%.4f)*on/%d" % (z0, z1 - z0, nf)
    y = max(0, BOX_CY - bh // 2)
    vf = (
        "[0:v]crop=640:%d:0:%d,split=2[bg][fg];"
        "[bg]scale=120:214,boxblur=7:1,scale=270:480,boxblur=6:1,scale=%d:%d,"
        "eq=brightness=0.04:saturation=1.05[bgb];"
        "[fg]crop=%d:%d:%d:0,scale=%d:%d,setsar=1,"
        "zoompan=z='%s':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:fps=%d:s=%dx%d,"
        "drawbox=x=0:y=0:w=iw:h=ih:color=white@0.12:t=3[fgz];"
        "[bgb][fgz]overlay=0:%d:shortest=1,format=yuv420p[v]"
        % (ACT_H, ACT_Y, CW, CH, w, ACT_H, x, bw, bh, zexpr, FPS, bw, bh, y)
    )
    run('ffmpeg -y -v error -ss %.3f -t %.3f -i "%s" -an -filter_complex "%s" '
        '-map "[v]" -r %d -c:v libx264 -preset veryfast -crf 17 -g 60 "%s"'
        % (a, dur, SRC, vf, FPS, out))

def build_segs(clip):
    cid = clip["id"]; base = os.path.join(WORK, "c%d" % cid)
    segs = plan(clip)
    files = ["%s_s%02d.mp4" % (base, i) for i in range(len(segs))]
    from concurrent.futures import ThreadPoolExecutor
    with ThreadPoolExecutor(max_workers=4) as ex:
        list(ex.map(lambda t: seg_video(t[1][0], t[1][1], t[1][2], files[t[0]], t[0]),
                    list(enumerate(segs))))
    lst = base + "_list.txt"
    open(lst, "w").write("".join("file '%s'\n" % f for f in files))
    cat = base + "_cat.mp4"
    run('ffmpeg -y -v error -f concat -safe 0 -i "%s" -c copy "%s"' % (lst, cat))
    return segs


def build_final(clip):
    cid = clip["id"]; base = os.path.join(WORK, "c%d" % cid)
    segs = plan(clip)
    cat = base + "_cat.mp4"
    dur = clip["end"] - clip["start"]
    ass = base + ".ass"; make_ass(clip, ass)
    sfx = base + "_sfx.wav"
    whoosh_track([s[0] - clip["start"] for s in segs[1:]], dur, sfx)

    out = os.path.join(OUT, "reel_%s.mp4" % clip["name"])
    run('ffmpeg -y -v error -i "%s" -ss %.3f -t %.3f -i "%s" -i "%s" '
        '-filter_complex "[0:v]ass=%s[v];'
        '[1:a]highpass=f=85,loudnorm=I=-14:TP=-1.5:LRA=11[vo];'
        '[vo][2:a]amix=inputs=2:weights=1 0.9:normalize=0,alimiter=limit=0.97[a]" '
        '-map "[v]" -map "[a]" -c:v libx264 -preset fast -crf 19 -pix_fmt yuv420p '
        '-profile:v high -level 4.1 -movflags +faststart -c:a aac -b:a 160k -ar 44100 "%s"'
        % (cat, clip["start"], dur, SRC, sfx, ass, out))
    return out, segs

if __name__ == "__main__":
    mode = sys.argv[1]
    for cid in [int(x) for x in sys.argv[2:]]:
        c = [c for c in CLIPS if c["id"] == cid][0]
        if mode == "segs":
            segs = build_segs(c)
            print("cortes clip %d (%d):" % (cid, len(segs)), " ".join(s[2] for s in segs))
        else:
            o, segs = build_final(c)
            print("OK", os.path.basename(o))

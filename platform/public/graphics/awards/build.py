#!/usr/bin/env python3
"""Builds awards/output.html from src/output.src.html.
It lifts the logo artwork and its animation script out of the official idle logo page and
drops the black backing so the logo sits on the moving background.
Run from the awards folder:  python3 build.py
Add --single <file> to also write a one-file preview (fonts, background, sample teams inlined;
steps through on its own with sample winners). The preview leaves out real team pictures."""
import base64, json, os, re, sys
here = os.path.dirname(os.path.abspath(__file__))
intro = os.path.join(here, "..", "team-intro")
LOGO = os.path.expanduser("~/Documents/STEM Racing/India Official/STEM Racing Regional Finals India_Idle.html")
logo = open(LOGO, encoding="utf-8").read()
svg = logo[logo.index("<svg"):logo.index("</svg>") + 6]
script = logo[logo.index("<script"):logo.index("</script>") + 9]
svg, n = re.subn(r'<rect x="-10" y="-60" width="1200" height="700" fill="#000"/>\s*', "", svg, count=1)
assert n == 1, "black backing rect not found - the logo file has changed"
# the gradient travels on the holding screen (at the file's own speed) and the title screen (one slow lap every LAP seconds); elsewhere it glides to the still logo and stops
LAP = 48
old_loop = script[script.index("if(!/[?&]capture/"):script.index("})();")]
assert "requestAnimationFrame(loop)" in old_loop, "logo loop not found - the logo file has changed"
new_loop = """let ph=0,last=null,still=false; window.seek(0);
const loop=ts=>{const dt=last===null?0:Math.min(.1,(ts-last)/1000); last=ts;
  const cl=document.getElementById('screen').classList, lap=cl.contains('k-idle')?DUR:cl.contains('k-title')?%d:0;
  if(lap){ph+=dt/lap; still=false; window.seek((ph%%1)*DUR);}
  else if(!still){const to=Math.round(ph); ph+=(to-ph)*Math.min(1,dt*2.5); if(Math.abs(to-ph)<.002){ph=0; still=true;} window.seek((ph%%1)*DUR);}
  requestAnimationFrame(loop);};
requestAnimationFrame(loop);
""" % LAP
script = script.replace(old_loop, new_loop)
page = open(os.path.join(here, "src", "output.src.html"), encoding="utf-8").read()
wall = open(os.path.expanduser("~/Documents/STEM Racing/India Official/STEM Racing Regional Finals India_Colour_White.svg"), "rb").read()
partner = open(os.path.join(here, "assets", "stemplify-on-dark.svg"), "rb").read()
wall_tag = "<script>window.WALL_LOGO=\"data:image/svg+xml;base64,%s\";window.WALL_PARTNER=\"data:image/svg+xml;base64,%s\";</" % (base64.b64encode(wall).decode(), base64.b64encode(partner).decode()) + "script>\n"
page = page.replace("<!--LOGO_SVG-->", svg).replace("<!--LOGO_SCRIPT-->", script)
assert "<script" in page
PAT = os.path.expanduser("~/Documents/STEM Racing/STEM RACING BRANDING SHARE/Graphic Assets/Patterns/RGB/PNG/STEM Racing Patterns_%s RGB.png")
pats = {k.lower(): "data:image/png;base64," + base64.b64encode(open(PAT % k, "rb").read()).decode() for k in ("Jagged", "Wave", "Curve")}
wall_tag = "<script>window.PATTERNS=%s;</" % json.dumps(pats) + "script>\n" + wall_tag
# the presenter screen's track shape: the supplied animated pink shape, made mountable (plays once, then holds)
SHAPE = os.path.expanduser("~/Documents/STEM Racing/SR Shapes Animated/STEM Racing Shapes_Pink_Animation.html")
sh = open(SHAPE, encoding="utf-8").read()
sh_svg = sh[sh.index("<svg"):sh.index("</svg>") + 6]
sh_svg, n = re.subn(r'<rect [^>]*fill="#000"/>\s*', "", sh_svg, count=1)
assert n == 1, "black backing rect not found - the shape file has changed"
ids = re.findall(r'id="([^"]+)"', sh_svg)
for i in ids:
    sh_svg = sh_svg.replace('id="%s"' % i, 'id="ps-%s"' % i).replace("url(#%s)" % i, "url(#ps-%s)" % i)
sh_js = sh[sh.index("<script>") + 8:sh.index("</script>")].strip()
assert sh_js.startswith("(function(){") and sh_js.endswith("})();")
sh_js = sh_js[len("(function(){"):-len("})();")]
sh_js = sh_js[:sh_js.index("window.seek=render;")]
for a, b_ in [("const $=id=>document.getElementById(id);", "const $=id=>root.querySelector('#ps-'+id);"),
              (", root=document.querySelector('svg');", ";"), ("'url(#m)'", "'url(#ps-m)'")]:
    assert sh_js.count(a) == 1, a
    sh_js = sh_js.replace(a, b_)
shape_tag = ("<script>window.SRPinkShape={mount:function(host,still){const SLOW=1.4; host.innerHTML=%s; const root=host.querySelector('svg');\n" % json.dumps(sh_svg).replace("</", "<\\/")
             + sh_js + "\nif(still){render(DUR);return;} let t0=null; const loop=ts=>{if(!root.isConnected)return; if(t0===null)t0=ts; const t=(ts-t0)/1000/SLOW; render(Math.min(t,DUR)); if(t<DUR)requestAnimationFrame(loop);}; render(0); requestAnimationFrame(loop);}};</" + "script>\n")
wall_tag = shape_tag + wall_tag
page = page.replace("<script", wall_tag + "<script", 1)
open(os.path.join(here, "output.html"), "w", encoding="utf-8").write(page)
print("wrote output.html")
if "--single" in sys.argv:
    out = sys.argv[sys.argv.index("--single") + 1]
    read = lambda *p: open(os.path.join(*p), encoding="utf-8").read()
    def font(m):
        p = os.path.normpath(os.path.join(here, m.group(1)))
        return "url(data:font/woff2;base64,%s)" % base64.b64encode(open(p, "rb").read()).decode()
    single = re.sub(r"url\((\.\./[^)]+\.woff2)\)", font, page)
    teams_js = read(intro, "teams.js")
    teams = json.loads(teams_js[teams_js.index("["):teams_js.index("];") + 1])
    fakes = [t for t in teams if t.get("fake")][:18]
    star = dict(next(t for t in teams if t["id"] == "001")); star.pop("photo", None)  # the real team, without its group photo
    fakes = [star] + fakes
    data = {}
    for t in fakes:
        for k in ("logo", "schoolLogo", "photo", "car"):
            if t.get(k):
                raw = open(os.path.join(intro, t[k]), "rb").read()
                data[t[k]] = "data:image/%s;base64," % ("png" if t[k].endswith(".png") else "svg+xml") + base64.b64encode(raw).decode()
    pres = re.search(r'photo: "(assets/[^"]+)"', read(here, "awards.js"))
    if pres: data[pres.group(1)] = "data:image/jpeg;base64," + base64.b64encode(open(os.path.join(here, pres.group(1)), "rb").read()).decode()
    inline = {
        '<script src="../shared/sr-background.js"></script>': read(here, "..", "shared", "sr-background.js"),
        '<script src="../team-intro/teams.js"></script>': "window.SRI_DEMO=true;window.TEAMS=%s;window.ASSET_DATA=%s;" % (json.dumps(fakes), json.dumps(data)),
        '<script src="../team-intro/brand-shape.js"></script>': read(intro, "brand-shape.js"),
        '<script src="awards.js"></script>': read(here, "awards.js"),
        '<script src="show.js"></script>': read(here, "show.js"),
    }
    for tag, code in inline.items():
        assert tag in single and "</script>" not in code, tag
        single = single.replace(tag, "<script>" + code + "</script>")
    for tag in ['<!doctype html>', '<html lang="en">', '<head>', '</head>', '<body>', '</body>', '</html>',
                '<meta charset="utf-8">', '<meta name="viewport" content="width=device-width,initial-scale=1">']:
        single = single.replace(tag, "", 1)
    single = single.replace("overflow:hidden}", "overflow:hidden;color-scheme:dark}", 1).replace("SRi Awards Output", "SRi Awards Show", 1)
    open(out, "w", encoding="utf-8").write(single.lstrip())
    print("wrote", out, len(single))
if "--control" in sys.argv:
    # one-file version of the control page for publishing: the big screen above is embedded as the preview,
    # the team list is the same sample set, and empty picks are filled with test results on first open.
    assert "--single" in sys.argv, "--control needs --single as well"
    out = sys.argv[sys.argv.index("--control") + 1]
    ctl = open(os.path.join(here, "control.html"), encoding="utf-8").read()
    ctl = re.sub(r"url\((\.\./[^)]+\.woff2)\)", font, ctl)
    slim = [{k: t[k] for k in ("id", "name", "school", "fake") if k in t} for t in fakes]
    embed = json.dumps(single.lstrip()).replace("</", "<\\/")
    swaps = {
        '<script src="../team-intro/teams.js"></script>': "<script>window.TEAMS=%s;window.OUT_HTML=%s;</script>" % (json.dumps(slim), embed),
        '<script src="awards.js"></script>': "<script>" + read(here, "awards.js") + "</script>",
        '<script src="show.js"></script>': "<script>" + read(here, "show.js") + "</script>",
        '<iframe id="preview" src="output.html"': '<iframe id="preview" allow="fullscreen"',
        '<button id="open" type="button">Open big screen</button>': '<button id="open" type="button">Fullscreen</button>',
        "$('open').addEventListener('click',()=>{out=window.open('output.html','sri-awards-output','width=1280,height=720'); setTimeout(send,600);});":
            "$('open').addEventListener('click',()=>{const p=frame.requestFullscreen&&frame.requestFullscreen(); if(p&&p.catch)p.catch(()=>{$('warn').textContent='Fullscreen is not available here.';});});",
        "setHidden(hidden); if(autofill)refresh(); chips(); paint(); frame.addEventListener('load',send);":
            "setHidden(hidden); if(autofill)refresh(); chips(); paint(); frame.addEventListener('load',send); frame.srcdoc='<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\"><style>html,body{margin:0;height:100%;background:#05000B}</style></head><body>'+window.OUT_HTML+'</body></html>';",
        "<header>": "<p class=\"sample\">Test version: sample teams only. Results entered here are shared with everyone who can open this page.</p>\n<header>",
        "on the big screen press <kbd>F</kbd> for fullscreen. ": "",
    }
    for a, b_ in swaps.items():
        assert ctl.count(a) == 1, a[:60]
        ctl = ctl.replace(a, b_)
    for tag in ['<!doctype html>', '<html lang="en">', '<head>', '</head>', '<body>', '</body></html>',
                '<meta charset="utf-8">', '<meta name="viewport" content="width=device-width,initial-scale=1">']:
        assert tag in ctl, tag
        ctl = ctl.replace(tag, "", 1)
    ctl = ctl.replace("</style>", ".sample{margin:0;padding:6px max(16px,env(safe-area-inset-right,0px)) 6px max(16px,env(safe-area-inset-left,0px));background:var(--gold);color:var(--carbon);font-weight:700;font-size:13px}\n</style>", 1)
    open(out, "w", encoding="utf-8").write(ctl.lstrip())
    print("wrote", out, len(ctl))

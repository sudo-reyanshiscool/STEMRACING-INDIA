#!/usr/bin/env python3
"""Packs the whole graphics platform (control.html + screen.html + the awards show + the race graphics)
into ONE file for publishing as a claude.ai page:  python3 build.py <out.html>
It first rebuilds awards/output.html (see awards/build.py). The packed version carries the sample team set only
(Supercharged without its group photo, plus 18 invented teams); the files in this folder are the real thing
and need no build step apart from awards/build.py."""
import base64, json, mimetypes, os, re, subprocess, sys, tempfile
here = os.path.dirname(os.path.abspath(__file__))
intro, awards = os.path.join(here, "team-intro"), os.path.join(here, "awards")
read = lambda *p: open(os.path.join(*p), encoding="utf-8").read()
out = sys.argv[1]

def uri(path):
    kind = {".png": "image/png", ".svg": "image/svg+xml", ".jpg": "image/jpeg", ".woff2": "font/woff2", ".otf": "font/otf"}[os.path.splitext(path)[1]]
    return "data:%s;base64,%s" % (kind, base64.b64encode(open(path, "rb").read()).decode())
def js(value):
    "JSON that is safe to sit inside a <script> element"
    return json.dumps(value).replace("</", "<\\/").replace("<!--", "<\\!--")
def swap(text, pairs):
    for a, b in pairs:
        assert text.count(a) == 1, a[:70]
        text = text.replace(a, b)
    return text

# 1. the awards show, as one file
tmp = os.path.join(tempfile.mkdtemp(), "awards.html")
subprocess.run([sys.executable, os.path.join(awards, "build.py"), "--single", tmp], check=True, cwd=awards)
awards_one = read(tmp)

# 2. the same sample team set the awards file carries
teams_js = read(intro, "teams.js")
teams = json.loads(teams_js[teams_js.index("["):teams_js.index("];") + 1])
star = dict(next(t for t in teams if t["id"] == "001")); star.pop("photo", None)   # the real team, without its group photo
sample = [star] + [t for t in teams if t.get("fake")][:18]
extras = teams_js[teams_js.index("];") + 2:]          # slogans (and rounds, if listed)

# 3. the race graphics, as one file
packed = [dict(t, **{k: uri(os.path.join(intro, t[k])) for k in ("logo", "schoolLogo", "car", "photo") if t.get(k)}) for t in sample]
race = read(intro, "output.html")
race = re.sub(r'url\("(assets/fonts/[^"]+)"\)', lambda m: 'url("%s")' % uri(os.path.join(intro, m.group(1))), race)
race = swap(race, [
    ('<script src="teams.js"></script>', "<script>window.TEAMS=%s;%s</script>" % (js(packed), extras)),
    ('<script src="brand-shape.js"></script>', "<script>" + read(intro, "brand-shape.js") + "</script>"),
    ('<script src="assets/brand/rf-idle-logo.js"></script>', ""),          # its own holding screen is never shown here
    ('<img src="assets/brand/sr-india-colour-white.png" alt="">', ""),
])
assert "assets/" not in race.replace("assets/teams", ""), "a file reference was left behind in the race graphics"

# 4. the big screen, holding both
screen = read(here, "screen.html")
# the car analysis page, as one file
ana = read(here, "analysis", "output.html")
ana = re.sub(r'url\("\.\./(team-intro/assets/fonts/[^"]+)"\)', lambda m: 'url("%s")' % uri(os.path.join(here, m.group(1))), ana)
ana = swap(ana, [('<script src="../shared/sr-background.js"></script>', "<script>" + read(here, "shared", "sr-background.js") + "</script>")])
assert 'src="../' not in ana and 'url("../' not in ana, "a file reference was left behind in the analysis page"
# the pit build timer page, as one file
pit = read(here, "pit", "output.html")
pit = re.sub(r'url\("\.\./(team-intro/assets/fonts/[^"]+)"\)', lambda m: 'url("%s")' % uri(os.path.join(here, m.group(1))), pit)
pit = swap(pit, [
    ("<!--PATTERNS-->", "<script>window.PIT_PATTERNS=%s;</script>" % js({k: uri(os.path.join(here, "pit", "patterns", k + ".png")) for k in ("curve", "jagged", "wave")})),
    ('<script src="../shared/sr-background.js"></script>', "<script>" + read(here, "shared", "sr-background.js") + "</script>"),
    ('<script src="../team-intro/brand-shape.js"></script>', "<script>" + read(intro, "brand-shape.js") + "</script>"),
    ('<script src="../team-intro/assets/brand/rf-idle-logo.js"></script>', "<script>" + read(intro, "assets", "brand", "rf-idle-logo.js") + "</script>"),
])
assert 'src="../' not in pit and 'url("../' not in pit, "a file reference was left behind in the pit build page"
screen = screen.replace("<script>", "<script>window.SRI_PARTS=%s;</script>\n<script>" % js({"awards": awards_one, "race": race, "analysis": ana, "pit": pit}), 1)

# 5. the control page, holding the big screen
slim = [{k: t[k] for k in ("id", "name", "school", "fake") if k in t} for t in sample]
ctl = read(here, "control.html")
ctl = re.sub(r"url\((team-intro/[^)]+\.woff2)\)", lambda m: "url(%s)" % uri(os.path.join(here, m.group(1))), ctl)
ctl = swap(ctl, [
    ('<script src="team-intro/teams.js"></script>', "<script>window.TEAMS=%s;%s\nwindow.OUT_HTML=%s;</script>" % (js(slim), extras, js(screen))),
    ('<script src="awards/awards.js"></script>', "<script>" + read(awards, "awards.js") + "</script>"),
    ('<script src="awards/show.js"></script>', "<script>" + read(awards, "show.js") + "</script>"),
    ('<script src="opening.js"></script>', "<script>" + read(here, "opening.js") + "</script>"),
    ('<script src="event-data.js"></script>', "<script>" + read(here, "event-data.js") + "</script>"),
    ('<script src="analysis.js"></script>', "<script>" + read(here, "analysis.js") + "</script>"),
])
for tag in ['<!doctype html>', '<html lang="en">', '<head>', '</head>', '<body>', '</body></html>',
            '<meta charset="utf-8">', '<meta name="viewport" content="width=device-width,initial-scale=1">']:
    assert tag in ctl, tag
    ctl = ctl.replace(tag, "", 1)
open(out, "w", encoding="utf-8").write(ctl.lstrip())
print("wrote", out, len(ctl))

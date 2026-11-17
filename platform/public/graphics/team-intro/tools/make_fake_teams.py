#!/usr/bin/env python3
"""Generate 50 fake teams for testing: a logo, a school crest, a car picture and a drawn team picture each,
plus teams.js. Everything it makes is invented. Run from the team-intro folder:

    python3 tools/make_fake_teams.py
"""
import colorsys
import json
import math
import random
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "assets" / "teams" / "fake"
random.seed(27)  # same teams every run

TEAM_NAMES = [
    "Apex", "Vortex Racing", "Turbo Titans", "Zenith", "Ignition Racing", "Velocity Vipers",
    "Carbon Comets", "Slipstream", "Redline Rockets", "Quantum Velocity Racing", "Aero Aces",
    "Throttle Theory", "Pit Lane Panthers", "Mach One", "Downforce Dynamics", "Nitro Knights",
    "Kinetic", "Gridline", "Phoenix Propulsion", "Torque Titans", "Blaze Motorsport",
    "Stratos", "Chicane Chasers", "Photon Racing", "Drift Dynasty", "Hyperion",
    "Monsoon Motorsport", "Falcon Force", "Tachyon", "Overdrive Owls", "Lightspeed Legion",
    "Cobra Racing", "Momentum", "Aurora Aerodynamics", "Thunderbolt Racing", "Pulse",
    "Supersonic Sharks", "Vector Racing", "Rapid Rhinos", "Eclipse Engineering", "Boost",
    "Sidewinder Speed Lab", "Tailwind", "Octane Orbit", "Flux Racing", "Comet Crew",
    "Launch Control", "Velocity Vanguard Racing Team", "Pole Position", "Afterburner",
]
SCHOOL_FIRST = ["Riverbend", "Maple Crest", "Silverline", "Banyan Grove", "Lotus Valley", "Peacock Hill",
                "Indus Heights", "Sunridge", "Harbour View", "Cedar Park", "Saffron Fields", "Monsoon Bay",
                "Skyline", "Greenleaf", "Stonebridge", "Golden Mile", "Lakeshore"]
SCHOOL_LAST = ["International School", "Academy", "Public School", "High School", "World School", "Senior School"]


def hexc(h, s, l):
    r, g, b = colorsys.hls_to_rgb(h % 1, l, s)
    return "#%02X%02X%02X" % (round(r * 255), round(g * 255), round(b * 255))


def initials(name, limit=3):
    return "".join(w[0] for w in name.split())[:limit].upper()


def polygon(points):
    return " ".join("%.1f,%.1f" % p for p in points)


def badge(kind):
    """Outer badge outline in a 512 box."""
    if kind == 0:  # shield
        return '<path d="M256 34 L448 96 V262 C448 372 366 446 256 482 C146 446 64 372 64 262 V96 Z"/>'
    if kind == 1:  # hexagon
        pts = [(256 + 226 * math.cos(math.radians(a)), 256 + 226 * math.sin(math.radians(a))) for a in range(-90, 270, 60)]
        return '<polygon points="%s"/>' % polygon(pts)
    if kind == 2:  # circle
        return '<circle cx="256" cy="256" r="222"/>'
    if kind == 3:  # slanted block
        return '<polygon points="120,56 482,56 392,456 30,456"/>'
    return '<polygon points="256,30 482,256 256,482 30,256"/>'  # diamond


def motif(kind, colour):
    if kind == 0:  # speed stripes
        return "".join('<polygon points="%d,%d %d,%d %d,%d %d,%d" fill="%s" opacity=".85"/>' % (70, y, 470, y - 60, 470, y - 34, 70, y + 26, colour) for y in (330, 380, 430))
    if kind == 1:  # chevrons
        return "".join('<polyline points="%d,400 256,%d %d,400" fill="none" stroke="%s" stroke-width="22" stroke-linejoin="miter" opacity=".9"/>' % (256 - w, 400 - h, 256 + w, colour) for w, h in ((150, 70), (100, 46)))
    if kind == 2:  # ring
        return '<circle cx="256" cy="256" r="176" fill="none" stroke="%s" stroke-width="16" stroke-dasharray="60 22" opacity=".9"/>' % colour
    if kind == 3:  # bolt
        return '<polygon points="300,60 150,290 240,290 200,452 372,208 276,208" fill="%s" opacity=".55"/>' % colour
    return '<polygon points="256,330 330,440 182,440" fill="%s" opacity=".9"/>' % colour  # arrow


def logo_svg(name, c1, c2, c3, kind, mot):
    text = initials(name)
    size = {1: 230, 2: 190, 3: 150}[len(text)]
    y = 256 + size * 0.34 - (30 if mot in (0, 1, 4) else 0)
    return f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" role="img" aria-label="{name} logo (fake)">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="{c1}"/><stop offset="1" stop-color="{c2}"/></linearGradient>
<clipPath id="c">{badge(kind)}</clipPath></defs>
<g fill="url(#g)" stroke="#FFFFFF" stroke-width="14" stroke-linejoin="round">{badge(kind)}</g>
<g clip-path="url(#c)">{motif(mot, c3)}</g>
<text x="256" y="{y:.0f}" text-anchor="middle" font-family="Arial Black, Arial, Helvetica, sans-serif" font-weight="900" font-style="italic" font-size="{size}" fill="#FFFFFF" stroke="{c2}" stroke-width="6" paint-order="stroke">{text}</text>
</svg>
'''


def crest_svg(school, c1, c2):
    text = initials(school, 4)
    size = {1: 150, 2: 130, 3: 100, 4: 80}[len(text)]
    ring = min(34, (530 / len(school) - 3) / 0.7)  # keep the whole name on the arc
    return f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" role="img" aria-label="{school} crest (fake)">
<defs><path id="arc" d="M 76 256 A 180 180 0 0 1 436 256"/></defs>
<circle cx="256" cy="256" r="244" fill="#FFFFFF"/>
<circle cx="256" cy="256" r="232" fill="{c1}"/>
<circle cx="256" cy="256" r="150" fill="#FFFFFF"/>
<circle cx="256" cy="256" r="138" fill="none" stroke="{c2}" stroke-width="6"/>
<text font-family="Arial, Helvetica, sans-serif" font-weight="700" font-size="{ring:.1f}" letter-spacing="3" fill="#FFFFFF" text-anchor="middle"><textPath href="#arc" startOffset="50%">{school.upper()}</textPath></text>
<text x="256" y="{256 + size * 0.35:.0f}" text-anchor="middle" font-family="Georgia, 'Times New Roman', serif" font-weight="700" font-size="{size}" fill="{c1}">{text}</text>
<polygon points="256,420 268,446 296,448 274,466 282,494 256,478 230,494 238,466 216,448 244,446" fill="#FFFFFF"/>
</svg>
'''


def car_svg(name, c1, c2, c3, number):
    return f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 900 300" role="img" aria-label="{name} car (fake)">
<defs><linearGradient id="b" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="{c2}"/><stop offset=".55" stop-color="{c1}"/><stop offset="1" stop-color="{c1}"/></linearGradient></defs>
<ellipse cx="450" cy="262" rx="400" ry="14" fill="#000000" opacity=".35"/>
<polygon points="60,70 150,70 150,96 132,96 132,196 104,196 104,96 60,96" fill="{c3}"/>
<rect x="52" y="58" width="110" height="18" rx="6" fill="{c2}"/>
<path d="M118 206 C150 150 250 120 380 120 L470 96 C520 84 560 96 590 124 L810 196 C836 204 848 216 850 232 L118 232 Z" fill="url(#b)" stroke="#FFFFFF" stroke-width="5" stroke-linejoin="round"/>
<path d="M420 122 L470 98 C512 88 546 98 570 120 L548 150 L420 150 Z" fill="#0B0B14" opacity=".8"/>
<polygon points="250,186 620,186 660,206 220,206" fill="{c3}" opacity=".9"/>
<polygon points="770,214 880,226 880,244 760,244" fill="{c3}"/>
<rect x="852" y="200" width="16" height="50" rx="4" fill="{c2}"/>
<g fill="#111118" stroke="#FFFFFF" stroke-width="5"><circle cx="230" cy="216" r="46"/><circle cx="700" cy="220" r="42"/></g>
<g fill="{c3}"><circle cx="230" cy="216" r="16"/><circle cx="700" cy="220" r="15"/></g>
<text x="350" y="178" font-family="Arial Black, Arial, sans-serif" font-weight="900" font-style="italic" font-size="44" fill="#FFFFFF">{number}</text>
</svg>
'''


def group_svg(name, c1, c2, c3, count):
    """A drawn stand-in for a team photo: simple figures in team shirts. Not real people."""
    skins = ["#F1C7A1", "#D9A066", "#B9783F", "#8D5524", "#E8B88A"]
    hair = ["#1B1B1F", "#3B2414", "#5A3A1C", "#101014"]
    width = 190 * count + 60
    figures = []
    for n in range(count):
        x = 125 + n * 190
        h = random.choice([0, 18, 34, 50])  # height difference
        skin, hr = random.choice(skins), random.choice(hair)
        top = 150 + h
        figures.append(f'''<g>
<rect x="{x - 46}" y="{top + 330}" width="40" height="{220 - h}" rx="14" fill="{skin}"/><rect x="{x + 6}" y="{top + 330}" width="40" height="{220 - h}" rx="14" fill="{skin}"/>
<rect x="{x - 62}" y="{top + 270}" width="124" height="120" rx="20" fill="#15151C"/>
<rect x="{x - 96}" y="{top + 112}" width="40" height="150" rx="20" fill="{skin}"/><rect x="{x + 56}" y="{top + 112}" width="40" height="150" rx="20" fill="{skin}"/>
<path d="M{x - 100} {top + 130} Q{x - 100} {top + 96} {x - 60} {top + 92} L{x + 60} {top + 92} Q{x + 100} {top + 96} {x + 100} {top + 130} L{x + 100} {top + 180} L{x + 70} {top + 180} L{x + 70} {top + 300} L{x - 70} {top + 300} L{x - 70} {top + 180} L{x - 100} {top + 180} Z" fill="{c1}"/>
<path d="M{x - 70} {top + 240} L{x + 70} {top + 200} L{x + 70} {top + 300} L{x - 70} {top + 300} Z" fill="{c2}" opacity=".55"/>
<rect x="{x - 26}" y="{top + 150}" width="52" height="12" rx="6" fill="{c3}"/>
<rect x="{x - 16}" y="{top + 62}" width="32" height="40" fill="{skin}"/>
<circle cx="{x}" cy="{top + 30}" r="52" fill="{skin}"/>
<path d="M{x - 54} {top + 26} A54 54 0 0 1 {x + 54} {top + 26} L{x + 54} {top + 8} A54 58 0 0 0 {x - 54} {top + 8} Z" fill="{hr}"/>
</g>''')
    return f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {width} 700" role="img" aria-label="{name} team picture (drawn stand-in, not real people)">
{"".join(figures)}
</svg>
'''


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    for old in OUT.glob("*.svg"):
        old.unlink()
    schools = [f"{a} {b}" for a in SCHOOL_FIRST for b in SCHOOL_LAST]
    random.shuffle(schools)
    teams = [{
        "id": "001", "name": "Supercharged", "school": "The British School",
        "colors": ["#E6007E", "#312783", "#FCBC00"],
        "logo": "assets/teams/001-logo.png", "schoolLogo": "assets/teams/school-tbs.png", "car": "assets/teams/001-car.png", "photo": "assets/teams/001-photo.png",  # car render supplied by the team (trimmed copy of 2.png)
    }]
    for i, name in enumerate(TEAM_NAMES):
        tid = "%03d" % (i + 2)
        hue = (i * 0.61803398875) % 1  # spread hues evenly
        c1 = hexc(hue, 0.78, 0.46)
        c2 = hexc(hue + random.choice([-0.08, 0.08, 0.5]), 0.7, 0.24)
        c3 = hexc(hue + random.choice([0.12, 0.33, 0.5]), 0.9, 0.62)
        school = schools[i]
        sh = random.random()
        (OUT / f"{tid}-logo.svg").write_text(logo_svg(name, c1, c2, c3, i % 5, (i * 3 + i // 5) % 5))
        (OUT / f"{tid}-school.svg").write_text(crest_svg(school, hexc(sh, 0.6, 0.3), hexc(sh + 0.1, 0.7, 0.5)))
        (OUT / f"{tid}-car.svg").write_text(car_svg(name, c1, c2, c3, i + 2))
        (OUT / f"{tid}-photo.svg").write_text(group_svg(name, c1, c2, c3, random.choice([3, 4, 4, 5, 6])))
        teams.append({
            "id": tid, "name": name, "school": school, "fake": True,
            "colors": [c1, c2, c3],
            "logo": f"assets/teams/fake/{tid}-logo.svg",
            "schoolLogo": f"assets/teams/fake/{tid}-school.svg",
            "car": f"assets/teams/fake/{tid}-car.svg",
            "photo": f"assets/teams/fake/{tid}-photo.svg",
        })
    lines = ",\n".join("  " + json.dumps(t) for t in teams)
    (ROOT / "teams.js").write_text(
        "// Teams shown in the control window. Edit this list for the real event.\n"
        "// Every team marked \"fake\": true is invented test data made by tools/make_fake_teams.py,\n"
        "// with made-up names, schools, logos, crests and car pictures. Remove them before a real event.\n"
        "// logo:       team logo file\n"
        "// schoolLogo: school crest file. Use null to show a placeholder roundel.\n"
        "// car:        car picture file. Use null to leave the car slot empty.\n"
        "// photo:      whole-team picture, shown on the qualification screen. Use null for none.\n"
        "// colors:     three team colours, used to fill the STEM Racing shape on the two-team screen.\n"
        "window.TEAMS = [\n" + lines + "\n];\n\n"
        "// Slogans offered in the control window. The first one is the default.\n"
        "window.SLOGANS = [\n  \"Accelerating futures\"\n];\n"
    )
    print(f"Wrote {len(teams)} teams ({len(teams) - 1} fake) and {len(list(OUT.glob('*.svg')))} pictures")


if __name__ == "__main__":
    main()

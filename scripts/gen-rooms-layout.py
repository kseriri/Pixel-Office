#!/usr/bin/env python3
"""Generate default-layout-9.json: one compact, self-contained open office.

A single enclosed rectangle split into a 2x2 grid of open areas (no interior
walls). Three are project "work spaces" separated by coloured rugs, the fourth
(bottom-right) is the break lounge:
  - standing counter        (top-left)
  - facing office desks 2x2  (top-right)   -- people face each other
  - side-by-side counter     (bottom-left)
  - break lounge / sofas     (bottom-right)
Token usage lives in a top HUD, so there is no monitor room.

Run: python3 scripts/gen-rooms-layout.py webview-ui/public/assets/default-layout-9.json
"""
import json, sys
from collections import Counter

WALL = 0
COLS, ROWS = 17, 15   # col0 + cols1..15 office + col16 wall ; row0 + rows1..13 + row14 wall

# floor palette (Colorize HSBC). One neutral office base + 3 zone rugs + cream break.
FL = {'OFFICE':1,'Z1':2,'Z2':3,'Z3':4,'BREAK':6}
COLOR = {
  1:{"h":40,"s":12,"b":30,"c":0},    # office base: warm light neutral
  2:{"h":205,"s":42,"b":22,"c":0},   # zone 1 rug: sky blue
  3:{"h":150,"s":40,"b":22,"c":0},   # zone 2 rug: mint green
  4:{"h":30,"s":48,"b":24,"c":0},    # zone 3 rug: peach
  6:{"h":48,"s":40,"b":28,"c":0},    # break: sunny cream
}

# Work spaces + break are logical rects for project/seat assignment only -- there
# are no walls between them; the office floor is one continuous room.
ROOMS = [
  {"id":"zone-1","name":"Team 1","kind":"work","col":1,"row":1,"w":7,"h":6},
  {"id":"zone-2","name":"Team 2","kind":"work","col":9,"row":1,"w":7,"h":6},
  {"id":"zone-3","name":"Team 3","kind":"work","col":1,"row":8,"w":7,"h":6},
  {"id":"break","name":"Break","kind":"break","col":9,"row":8,"w":7,"h":6},
]

tiles=[[WALL]*COLS for _ in range(ROWS)]
colors=[[None]*COLS for _ in range(ROWS)]
def paint(c,r,floor):
    if 0<=r<ROWS and 0<=c<COLS:
        tiles[r][c]=floor; colors[r][c]=COLOR.get(floor)
def fill(c0,r0,w,h,floor):
    for r in range(r0,r0+h):
        for c in range(c0,c0+w):
            paint(c,r,floor)

# one continuous open office floor (cols 1..15, rows 1..13)
fill(1,1,15,13,FL['OFFICE'])

# zone rugs -- mark each project's "table space" + the break lounge
fill(1,2,6,4,FL['Z1'])
fill(9,2,6,4,FL['Z2'])
fill(1,9,6,4,FL['Z3'])
fill(9,9,6,4,FL['BREAK'])

furniture=[]
uidc=[0]
def add(t,c,r,color=None):
    uidc[0]+=1
    f={"uid":f"g{uidc[0]}","type":t,"col":c,"row":r}
    if color: f["color"]=color
    furniture.append(f)

# ── work spaces: chairs on top facing DOWN, with the desk + PC directly BELOW —
#    so a seated agent shows their face AND is looking at the PC (which lights up
#    while working). `c`,`r` = left column / chairs row; the row above the chairs
#    is left open as the approach corridor (agents reach seats from above), and
#    the desk columns leave a clear side column so pathing always works.
def workstation(c, r):
    # Two desk rows so the surface sits right under the agent (no "typing in the
    # air" gap); a back-facing monitor in front of each agent (screen faces them,
    # we see its back); chairs on top facing down.
    add("DESK_FRONT", c, r); add("DESK_FRONT", c + 3, r)            # desk row 1
    add("DESK_FRONT", c, r + 1); add("DESK_FRONT", c + 3, r + 1)    # desk row 2 (depth)
    for cc in (c, c + 1, c + 3, c + 4):
        add("PC_BACK", cc, r)                    # monitor directly in front of the agent
        add("CUSHIONED_CHAIR_FRONT", cc, r)      # agent seat, faces down

workstation(1, 3)    # zone 1 (top-left):  corridor row2, chairs row3, desk row4-5
workstation(9, 3)    # zone 2 (top-right)
workstation(1, 10)   # zone 3 (bottom-left): corridor row9, chairs row10, desk row11-12

# ── break lounge (bottom-right): a cosy sofa cluster + greenery ──
add("SOFA_FRONT",11,9)
add("SOFA_SIDE",10,10)
add("COFFEE_TABLE",11,10); add("COFFEE",11,10)
add("SOFA_SIDE:left",13,10)
add("SOFA_BACK",11,12)
add("PLANT_2",9,8); add("CACTUS",15,8)
add("LARGE_PLANT",9,11); add("BIN",15,13)

# ── wall art on the office top wall (row 0) ──
add("WHITEBOARD",2,0); add("SMALL_PAINTING",7,0)
add("CLOCK",10,0); add("SMALL_PAINTING",13,0)

layout={
  "version":1,"cols":COLS,"rows":ROWS,"layoutRevision":12,
  "tiles":[tiles[r][c] for r in range(ROWS) for c in range(COLS)],
  "tileColors":[colors[r][c] for r in range(ROWS) for c in range(COLS)],
  "furniture":furniture,
  "rooms":[{k:rm[k] for k in ("id","name","kind","col","row","w","h")} for rm in ROOMS],
  "pets":[{"id":"claudio-1","petType":0},{"id":"kimushi-1","petType":2}],
}

# ── verify: seat derivation (chairs, per footprint tile minus bg rows) ──
FP={"DESK_FRONT":(3,2,1,"desks"),"PC_FRONT_OFF":(1,2,1,"electronics"),"PC_BACK":(1,2,1,"electronics"),
    "CUSHIONED_BENCH":(1,1,0,"chairs"),"WOODEN_BENCH":(1,1,0,"chairs"),
    "CUSHIONED_CHAIR_FRONT":(1,1,0,"chairs"),"CUSHIONED_CHAIR_BACK":(1,1,0,"chairs"),
    "SOFA_FRONT":(2,1,0,"chairs"),"SOFA_BACK":(2,1,0,"chairs"),
    "SOFA_SIDE":(1,2,0,"chairs"),"SOFA_SIDE:left":(1,2,0,"chairs"),
    "COFFEE_TABLE":(2,2,0,"desks"),"COFFEE":(1,1,0,"misc"),
    "PLANT_2":(1,2,1,"decor"),"CACTUS":(1,2,1,"decor"),"LARGE_PLANT":(2,3,2,"decor"),
    "BIN":(1,1,0,"misc"),"SMALL_PAINTING":(1,2,0,"wall"),"CLOCK":(1,2,0,"wall"),
    "WHITEBOARD":(2,2,0,"wall")}
def room_of(c,r):
    for rm in ROOMS:
        if rm["col"]<=c<rm["col"]+rm["w"] and rm["row"]<=r<rm["row"]+rm["h"]: return rm["id"]
    return None
seats=[]
for f in furniture:
    w,h,bg,cat=FP[f["type"]]
    if cat!="chairs": continue
    for dr in range(bg,h):
        for dc in range(w):
            seats.append((f["col"]+dc,f["row"]+dr))
print("seats by room:", dict(Counter(room_of(c,r) for c,r in seats)))

# ── ASCII preview ──
seatset=set(seats)
solidset=set()
for f in furniture:
    w,h,bg,cat=FP[f["type"]]
    for dr in range(h):
        if dr<bg: continue
        for dc in range(w): solidset.add((f["col"]+dc,f["row"]+dr))
print(f"grid {COLS}x{ROWS} furn={len(furniture)}")
for r in range(ROWS):
    line=""
    for c in range(COLS):
        if (c,r) in seatset: line+="*"
        elif (c,r) in solidset: line+="#"
        elif tiles[r][c]==WALL: line+="█"
        elif tiles[r][c]==FL['BREAK']: line+="~"
        elif tiles[r][c] in (FL['Z1'],FL['Z2'],FL['Z3']): line+="="
        else: line+="·"
    print(line)

out=sys.argv[1] if len(sys.argv)>1 else "/dev/stdout"
if out!="/dev/stdout":
    json.dump(layout, open(out,"w")); print("wrote", out)

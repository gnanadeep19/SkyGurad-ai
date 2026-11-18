"""Slides 1-12: title, agenda, and Member 1 / Member 2 openings."""
from pptx.enum.shapes import MSO_SHAPE
from pptx.enum.text import MSO_ANCHOR, PP_ALIGN
from pptx.util import Inches

from deck_lib import (AMBER, CARD, GREY, INK, MONO, NAVY, PALE_TEAL, RGB_DARK,
                      RGB_LIGHT, RGB_MID, RGB_RED, RGB_RULE, TEAL, WHITE, bullets,
                      header, label, notes, rect, stat, table, text)

M1, M2, M3 = "Member 1", "Member 2", "Member 3"


def slide_title(prs):
    s = prs.slides.add_slide(prs.slide_layouts[6])
    rect(s, 0, 0, 13.333, 7.5, NAVY, radius=None, kind=MSO_SHAPE.RECTANGLE)
    rect(s, 0, 0, 0.14, 7.5, TEAL, radius=None, kind=MSO_SHAPE.RECTANGLE)
    text(s, 0.95, 1.05, 7.6, 0.3, "UNDERGRADUATE PROJECT PRESENTATION",
         size=11.5, bold=True, color=TEAL)
    text(s, 0.95, 1.55, 11.4, 1.9,
         "SkyGuard AI\nSource-Aware Anomaly Triage for\nAutomatic Weather Station Networks",
         size=36, bold=True, color=WHITE, spacing=1.02)
    text(s, 0.95, 3.85, 9.8, 0.5,
         "A monitoring stack that treats a suspicious reading as a question for a human, not a label.",
         size=14.5, color=RGB_LIGHT)
    rect(s, 0.95, 4.55, 5.9, 0.012, RGB_RULE, radius=None,
         kind=MSO_SHAPE.RECTANGLE)
    for i, (name, role) in enumerate([
            (M1, "Problem, architecture, data integrity"),
            (M2, "Detection methodology"),
            (M3, "Evaluation, incidents, conclusions")]):
        y = 4.80 + i * 0.62
        text(s, 0.95, y, 2.0, 0.3, name, size=13, bold=True, color=WHITE)
        text(s, 2.95, y, 6.2, 0.3, role, size=12, color=RGB_LIGHT)
    text(s, 0.95, 6.75, 8.0, 0.3,
         "Department of Computer Science and Engineering  \u00b7  November 2026",
         size=10.5, color=RGB_LIGHT)
    notes(s, "Open the presentation, introduce the three speakers by name and "
             "say the project in one sentence: SkyGuard AI watches a network of "
             "automatic weather stations and turns suspicious readings into "
             "reviewable incidents. Keep this slide to about 40 seconds, then "
             "hand over to Member 1.")


def slide_agenda(prs, n):
    s = prs.slides.add_slide(prs.slide_layouts[6])
    header(s, "AGENDA", "Three parts, one argument", n)
    rows = [
        ("1", "The operational problem", "Why an unlabelled network needs triage, and the architecture that supports it", M1, "6 min"),
        ("2", "How the detector decides", "Six features, a robust baseline, a seeded Isolation Forest, and a network-level check", M2, "7 min"),
        ("3", "What the evidence shows", "Replays, disagreement counts, perturbations, incident workflow and limits", M3, "7 min"),
    ]
    for i, (num, title, sub, who, mins) in enumerate(rows):
        y = 1.75 + i * 1.55
        rect(s, 0.65, y, 12.03, 1.32, CARD, radius=0.05)
        rect(s, 0.65, y, 0.07, 1.32, TEAL, radius=None, kind=MSO_SHAPE.RECTANGLE)
        text(s, 0.95, y + 0.24, 0.6, 0.6, num, size=28, bold=True, color=TEAL)
        text(s, 1.65, y + 0.20, 5.0, 0.4, title, size=17, bold=True, color=NAVY)
        text(s, 1.65, y + 0.62, 7.4, 0.55, sub, size=11.5, color=GREY)
        text(s, 9.35, y + 0.22, 1.55, 0.3, who, size=12, bold=True, color=NAVY,
             align=PP_ALIGN.RIGHT)
        text(s, 11.05, y + 0.22, 1.4, 0.3, mins, size=11, color=GREY,
             align=PP_ALIGN.RIGHT)
        text(s, 9.0, y + 0.68, 3.45, 0.3, "presenter", size=9.5, color=GREY,
             align=PP_ALIGN.RIGHT)
    notes(s, "Set expectations: roughly twenty minutes of speaking, three "
             "minutes of questions. Mention that each part ends with a short "
             "hand-off sentence so the transitions are clean.")


def slide_problem(prs, n):
    s = prs.slides.add_slide(prs.slide_layouts[6])
    header(s, "PART 1  \u00b7  THE PROBLEM", "A flagged reading has three possible causes",
           M1, n)
    bullets(s, 0.65, 1.70, 7.35, 3.9, [
        ("Scale:: 100 station locations across six Indian regions, a new reading every 15 minutes.", 0),
        ("Ambiguity:: an odd value may be unusual weather, a telemetry fault, or a failing sensor.", 0),
        ("No labels:: operational archives store the number, not the cause, so there is nothing to train on.", 0),
        ("Wrong question:: a single score does not tell an operator whether to spend an hour on it.", 0),
        ("Mixed provenance:: model estimates, station readings, replays and uploads can share one chart.", 0),
    ], size=15.5, gap=10)
    card = rect(s, 8.35, 1.75, 4.33, 3.60, NAVY, radius=0.06)
    text(s, 8.65, 1.98, 3.75, 0.3, "OUR POSITION", size=10, bold=True, color=TEAL)
    text(s, 8.65, 2.35, 3.72, 1.75,
         "Treat the task as triage, not supervised classification.",
         size=21, bold=True, color=WHITE, spacing=1.05)
    text(s, 8.65, 4.55, 3.7, 0.8,
         "The system ranks and explains; a person decides whether equipment needs attention.",
         size=11.5, color=RGB_LIGHT)
    for i, (v, c) in enumerate([("248", "replayed\nChennai readings"),
                                ("30.8%", "flag rate at\ndefault thresholds")]):
        stat(s, 0.65 + i * 3.85, 5.62, 3.6, 1.18, v, c)
    notes(s, "Spend the most time on the missing-label argument. Ask the "
             "audience: if a pressure value is odd, how would you know whether "
             "the weather changed or the sensor drifted? That gap is the whole "
             "motivation. Point at the two numbers: later, Member 3 shows these "
             "are flag rates, not accuracy.")


def slide_requirements(prs, n):
    s = prs.slides.add_slide(prs.slide_layouts[6])
    header(s, "PART 1  \u00b7  DESIGN POSITION", "Four requirements drove every design choice",
           M1, n)
    items = [
        ("No silent source mixing", "Every reading carries a source that survives into storage, the API and the interface."),
        ("Explainable rejection", "A discarded reading produces a named reason an operator can read, not just a counter."),
        ("Human in the loop", "The system ranks and contextualises; a person decides whether equipment needs attention."),
        ("No uncalibrated numbers", "Fields that imply probability are either calibrated or absent. The API returns confidence: null."),
    ]
    for i, (title, body) in enumerate(items):
        x = 0.65 + (i % 2) * 6.12
        y = 1.75 + (i // 2) * 2.25
        rect(s, x, y, 5.9, 1.95, CARD, radius=0.05)
        rect(s, x, y, 0.07, 1.95, TEAL if i % 2 == 0 else AMBER, radius=None,
             kind=MSO_SHAPE.RECTANGLE)
        text(s, x + 0.3, y + 0.22, 5.3, 0.35, f"0{i + 1}", size=11, bold=True, color=TEAL)
        text(s, x + 0.3, y + 0.55, 5.3, 0.4, title, size=17, bold=True, color=NAVY)
        text(s, x + 0.3, y + 1.02, 5.25, 0.8, body, size=12, color=GREY, spacing=1.05)
    notes(s, "The fourth requirement is the unusual one. Explain that a "
             "plausible-looking score is more dangerous than an honest gap, "
             "because interfaces are read by people who never saw the release "
             "notes. This requirement explains the null confidence field later.")


def slide_architecture(prs, n):
    s = prs.slides.add_slide(prs.slide_layouts[6])
    header(s, "PART 1  \u00b7  SYSTEM ARCHITECTURE", "One repository, four layers",
           M1, n)
    sources = ["Open-Meteo API\nmodel estimates", "Station / gateway\nHTTPS, device token",
               "CSV upload\nanalyst import"]
    for i, src in enumerate(sources):
        box = rect(s, 0.65 + i * 4.02, 1.62, 3.75, 0.66, PALE_TEAL, radius=0.10)
        label(box, src, size=10.5, color=NAVY)
    text(s, 0.65, 2.34, 12.0, 0.26,
         "\u25bc   validate  \u00b7  source-tag  \u00b7  deduplicate   \u25bc",
         size=10, bold=True, color=GREY, align=PP_ALIGN.CENTER)
    layers = [
        ("Ingestion", "raw event journal  +  accepted observations", NAVY, WHITE),
        ("Detector", "median/MAD baseline  \u00b7  Isolation Forest  \u00b7  spatial agreement", RGB_MID, WHITE),
        ("Incident engine  +  REST API",
         "grouping  \u00b7  evidence  \u00b7  assignment  \u00b7  outbox  \u00b7  role-checked routes", PALE_TEAL, NAVY),
        ("Dashboard", "overview map  \u00b7  station feed  \u00b7  analytics  \u00b7  data quality", CARD, NAVY),
    ]
    for i, (name, sub, fill, fg) in enumerate(layers):
        y = 2.70 + i * 0.78
        box = rect(s, 0.65, y, 12.03, 0.62, fill, radius=0.12)
        label(box, f"{name}   \u2014   {sub}", size=11.5, bold=True, color=fg,
              align=PP_ALIGN.LEFT)
    text(s, 0.65, 5.95, 12.03, 0.55,
         "React 19 + Vite 7 dashboard  \u00b7  Express 4 + TypeScript 5.6 on Node 22  \u00b7  PostgreSQL or append-only JSONL  \u00b7  one Docker image, one origin",
         size=10.5, color=GREY, align=PP_ALIGN.CENTER)
    text(s, 0.65, 6.42, 12.03, 0.35,
         "The same validation and provenance path serves live feeds, device submissions and CSV uploads.",
         size=11, italic=True, color=NAVY, align=PP_ALIGN.CENTER)
    notes(s, "Trace one reading top to bottom with your hand. Emphasise that "
             "there is no separate Python service: the detector lives in the "
             "same Express process, which is why the demo runs on a laptop. "
             "Hand-off: provenance is only real if ingestion enforces it, which "
             "is the next slide.")


def slide_ingestion(prs, n):
    s = prs.slides.add_slide(prs.slide_layouts[6])
    header(s, "PART 1  \u00b7  INGESTION AND PROVENANCE", "Five sources, five visible trust labels",
           M1, n)
    table(s, 0.65, 1.72, 7.6, [
        ["Source", "Origin", "Scored", "Label shown"],
        ["open-meteo", "Modelled grid estimate", "Yes", "Model estimate"],
        ["station-api", "Submitted device reading", "Yes", "Station reading"],
        ["uploaded", "Analyst CSV import", "Offline", "Uploaded dataset"],
        ["replay", "Demonstration series", "Yes", "Replay"],
        ["legacy-unknown", "Provenance not recorded", "Historical", "Unverified"],
    ], [1.75, 2.55, 1.05, 2.25], size=11, row_h=0.44,
        align_right=(), bold_first=True)
    bullets(s, 8.55, 1.75, 4.15, 4.6, [
        ("Named issue codes:: missing_station, out_of_range, future_timestamp, unsupported_unit, duplicate.", 0),
        ("Reject vs warn:: an unknown station is a provenance gap, so it is accepted with a warning and surfaced.", 0),
        ("No implicit units:: an unlisted unit is refused, because a silent conversion is indistinguishable from a calibration error.", 0),
        ("Duplicates:: keyed on (source, station, time) and rejected at storage, so re-delivery is harmless.", 0),
    ], size=12.5, gap=9)
    notes(s, "Pick one row and one issue code rather than reading the table. "
             "The important idea is that rejection is a message, not a counter. "
             "Mention that the raw event is still journalled, so an operator can "
             "see what arrived twice.")


def slide_storage(prs, n):
    s = prs.slides.add_slide(prs.slide_layouts[6])
    header(s, "PART 1  \u00b7  STORAGE AND PROCESSING", "What was received stays separate from what was accepted",
           M1, n)
    bullets(s, 0.65, 1.72, 7.3, 4.5, [
        ("Append-only journal:: raw payload, quality status and issues sit beside accepted readings.", 0),
        ("Queued scoring:: new station readings insert as pending and are scored in observation order.", 0),
        ("No future leakage:: scoring needs 24 earlier readings within seven days; if history is short it stays unscored rather than borrowing later data.", 0),
        ("One transaction:: in PostgreSQL the score, alert, incident update and queue completion commit together.", 0),
        ("Honest staleness:: data older than 30 minutes is marked stale, cached values are labelled cached, and a failed fetch reports failure instead of inventing a replay.", 0),
    ], size=13.5, gap=9)
    card = rect(s, 8.25, 1.75, 4.43, 4.35, CARD, radius=0.05)
    text(s, 8.52, 1.95, 3.9, 0.3, "STORAGE IN BRIEF", size=10, bold=True, color=TEAL)
    rows = [("observation_events", "raw payload, append-only"),
            ("observations", "accepted, unique by source/station/time"),
            ("anomaly_results", "score and evidence per model version"),
            ("station_incidents", "one active per source and station"),
            ("notification_outbox", "queued mail with retries")]
    for i, (name, sub) in enumerate(rows):
        y = 2.35 + i * 0.72
        text(s, 8.52, y, 3.9, 0.26, name, size=11.5, bold=True, color=NAVY,
             font=MONO)
        text(s, 8.52, y + 0.27, 3.9, 0.3, sub, size=10, color=GREY)
    notes(s, "The strongest single decision is keeping the raw event table. "
             "When an operator asks why a reading vanished, the platform can "
             "show the payload, the failing field and the limit that was "
             "applied. Also mention the transactional guarantee and its "
             "documented absence in file mode.")


def slide_access(prs, n):
    s = prs.slides.add_slide(prs.slide_layouts[6])
    header(s, "PART 1  \u00b7  ROLES AND ACCESS", "Two roles, a narrow gateway, explicit limits",
           M1, n)
    left = rect(s, 0.65, 1.72, 5.9, 4.45, CARD, radius=0.05)
    text(s, 0.95, 1.94, 5.3, 0.3, "ACCOUNTS AND SESSIONS", size=10, bold=True, color=TEAL)
    bullets(s, 0.95, 2.30, 5.35, 3.6, [
        ("Administrators:: manage accounts, device credentials and thresholds.", 0),
        ("Operators:: monitor stations, review and assign incidents, analyse datasets.", 0),
        ("Passwords:: scrypt hashes with a per-user salt and constant-time comparison.", 0),
        ("Sessions:: held in memory for eight hours, so a restart signs everyone out.", 0),
        ("First run:: a one-time setup code printed to the server log, rotated on restart.", 0),
    ], size=12.5, gap=8)
    rect(s, 6.78, 1.72, 5.9, 4.45, NAVY, radius=0.05)
    text(s, 7.08, 1.94, 5.3, 0.3, "DEVICE GATEWAY", size=10, bold=True, color=TEAL)
    bullets(s, 7.08, 2.30, 5.35, 3.0, [
        ("TLS 1.2 or later, one route, non-JSON rejected.", 0),
        ("2 MB body cap and 120 requests per minute per address.", 0),
        ("Station-scoped credentials: random, hashed at rest, shown once, revocable.", 0),
        ("A batch naming a station outside the credential scope is refused before storage.", 0),
    ], size=12.5, gap=8, color=WHITE)
    badge = rect(s, 7.08, 5.10, 5.25, 0.85, RGB_DARK, radius=0.06)
    label(badge, "Threat model of a demonstration: no MFA, no distributed rate limiting, no key rotation.",
          size=10.5, color=RGB_LIGHT)
    notes(s, "Keep this brief and factual. The point is that the security is "
             "adequate for a local prototype and documented as insufficient for "
             "an internet-facing service. That candour is part of the "
             "contribution. Hand off to Member 2.")


def slide_detection_overview(prs, n):
    s = prs.slides.add_slide(prs.slide_layouts[6])
    header(s, "PART 2  \u00b7  DETECTION", "Three signals, one fused score", M2, n)
    cards = [
        ("Robust baseline", "Median and scaled MAD per field. Names the quantity and direction that moved.", TEAL),
        ("Isolation Forest", "64 seeded trees over six features. Catches joint configurations no single field explains.", NAVY),
        ("Spatial agreement", "Neighbour flags separate regional weather from a local irregularity.", AMBER),
    ]
    for i, (title, sub, color) in enumerate(cards):
        x = 0.65 + i * 2.85
        rect(s, x, 1.72, 2.62, 2.05, CARD, radius=0.05)
        rect(s, x, 1.72, 2.62, 0.06, color, radius=None, kind=MSO_SHAPE.RECTANGLE)
        text(s, x + 0.2, 1.92, 2.25, 0.3, title, size=13.5, bold=True, color=NAVY)
        text(s, x + 0.2, 2.30, 2.25, 1.3, sub, size=10.5, color=GREY, spacing=1.05)
    arrow = s.shapes.add_shape(MSO_SHAPE.RIGHT_ARROW, Inches(9.05), Inches(2.45),
                               Inches(0.62), Inches(0.55))
    arrow.fill.solid(); arrow.fill.fore_color.rgb = GRID
    arrow.line.fill.background(); arrow.shadow.inherit = False
    box = rect(s, 9.85, 1.72, 2.83, 2.05, NAVY, radius=0.06)
    text(s, 10.05, 1.90, 2.45, 0.3, "FUSED SCORE a", size=10, bold=True, color=TEAL)
    text(s, 10.05, 2.25, 2.45, 0.75, "a = 0.7 s\u2032 + 0.3 z", size=21, bold=True,
         color=WHITE, font=MONO)
    text(s, 10.05, 3.02, 2.45, 0.6, "0.32 and 0.62 separate three states", size=10,
         color=RGB_LIGHT)
    for i, (name, sub, color) in enumerate([
            ("Healthy", "a < 0.32", TEAL), ("Warning", "0.32 \u2264 a < 0.62", AMBER),
            ("Critical", "a \u2265 0.62", RGB_RED)]):
        x = 0.65 + i * 4.02
        chip = rect(s, x, 4.28, 3.75, 0.95, WHITE, line=color, radius=0.12)
        text(s, x + 0.22, 4.42, 1.6, 0.3, name, size=14, bold=True, color=NAVY)
        text(s, x + 0.22, 4.76, 3.3, 0.3, sub, size=10.5, color=GREY, font=MONO)
    text(s, 0.65, 5.55, 12.03, 0.9,
         "No learned parameter requires labelled faults, which is what lets the system run in an unlabelled deployment at all. Every constant is exposed in configuration, because a threshold is a policy choice and should be reviewable.",
         size=12, color=GREY, align=PP_ALIGN.CENTER, spacing=1.1)
    notes(s, "Give the shape of the method before any arithmetic: one explainable "
             "signal, one multivariate signal, one contextual signal. Say that "
             "the weights are deliberately unequal so the forest dominates but "
             "never completely hides the robust deviation. Hand-off: start with "
             "what a reading looks like to the detector.")


def slide_features(prs, n):
    s = prs.slides.add_slide(prs.slide_layouts[6])
    header(s, "PART 2  \u00b7  FEATURE REPRESENTATION", "Levels plus one-step increments",
           M2, n)
    eq = rect(s, 0.65, 1.75, 12.03, 1.05, NAVY, radius=0.06)
    label(eq, "x\u209c = [ T\u209c , H\u209c , P\u209c , \u0394T\u209c , \u0394H\u209c , \u0394P\u209c ]",
          size=26, bold=True, color=WHITE, font=MONO)
    text(s, 0.65, 2.92, 12.03, 0.3,
         "\u0394T\u209c = T\u209c \u2212 T\u209c\u208b\u2081, and likewise for humidity and pressure",
         size=11.5, color=GREY, align=PP_ALIGN.CENTER, font=MONO)
    bullets(s, 0.65, 3.48, 5.85, 3.0, [
        ("Why increments:: they make a step change visible without declaring a station's climate anomalous.", 0),
        ("Leh at \u22125 \u00b0C is normal:: a jump of 8 \u00b0C in one reading is not.", 0),
        ("Profile:: 24 to 96 prior readings, refitted every 24 readings so the baseline follows seasonal drift.", 0),
    ], size=13.5, gap=10)
    bullets(s, 6.80, 3.48, 5.85, 3.0, [
        ("Bounded cost:: the refit depends on the window, never on total history length.", 0),
        ("First reading:: increments are zero, so a station cannot be flagged on change alone at the very start.", 0),
        ("Two fields of evidence:: the model scores the vector while the interface still names the physical field.", 0),
    ], size=13.5, gap=10)
    notes(s, "Use the Leh example, it lands well. The design tension is that a "
             "detector on absolute values would call an entire cold station "
             "anomalous, so increments carry the step-change signal while the "
             "robust terms carry the level.")


def slide_baseline(prs, n):
    s = prs.slides.add_slide(prs.slide_layouts[6])
    header(s, "PART 2  \u00b7  ROBUST BASELINE", "A median is not moved by the outlier we are hunting",
           M2, n)
    for i, (eq, cap) in enumerate([
            ("c\u2c7c = med(x\u2081\u2c7c, \u2026, x\u2099\u2c7c)", "profile centre for field j"),
            ("\u03c3\u2c7c = max( 1.4826 \u00b7 med(|x\u1d62\u2c7c \u2212 c\u2c7c|), \u03b5 )", "scaled MAD, with a floor"),
            ("z\u2c7c = (x\u2c7c \u2212 c\u2c7c) / \u03c3\u2c7c", "per-reading deviation")]):
        y = 1.78 + i * 1.25
        box = rect(s, 0.65, y, 7.3, 0.95, CARD, radius=0.08)
        text(s, 0.95, y + 0.16, 6.7, 0.45, eq, size=15, bold=True, color=NAVY,
             font=MONO)
        text(s, 0.95, y + 0.60, 6.6, 0.28, cap, size=10, color=GREY)
    bullets(s, 8.35, 1.80, 4.3, 4.6, [
        ("Breakdown point:: the median ignores the very readings we are looking for.", 0),
        ("Consistency:: 1.4826 makes the scaled MAD match a standard deviation under normality.", 0),
        ("The floor \u03b5:: prevents division by zero when a sensor reports a constant value, which a frozen sensor really does.", 0),
        ("|z| \u2265 2:: reports the field as affected, with a direction. A reporting convention, not a calibrated boundary.", 0),
    ], size=12.5, gap=9)
    text(s, 0.65, 5.55, 7.3, 0.9,
         "The interface never converts this into a probability. It names the field, the direction and the size of the deviation.",
         size=12, italic=True, color=NAVY, align=PP_ALIGN.CENTER)
    notes(s, "Explain the breakdown point in one sentence: a mean would be "
             "dragged by the faulty reading, a median is not. The epsilon floor "
             "sounds like a detail but it exists because frozen sensors produce "
             "exactly constant series, which would otherwise divide by zero.")


def slide_forest(prs, n):
    s = prs.slides.add_slide(prs.slide_layouts[6])
    header(s, "PART 2  \u00b7  ISOLATION FOREST", "Random partitions, reproducible by seed",
           M2, n)
    for i, (v, c) in enumerate([("64", "trees per profile"), ("128", "vectors per subsample"),
                                ("6", "features per vector")]):
        stat(s, 0.65 + i * 2.05, 1.72, 2.00, 1.20, v, c, color=NAVY if i != 1 else TEAL)
    bullets(s, 0.65, 3.15, 5.95, 3.2, [
        ("How it isolates:: each tree splits at a random value on a random feature until a point is alone.", 0),
        ("Depth limit:: \u2308log\u2082 \u03c8\u2309, so easy-to-isolate points end up with short paths.", 0),
        ("Dependency-free:: implemented in the repository, no Python runtime and no model server.", 0),
        ("Seeded LCG:: the same observations reproduce the same scores, so a saved report can be verified.", 0),
    ], size=13, gap=9)
    box = rect(s, 6.95, 1.72, 5.73, 1.75, NAVY, radius=0.06)
    text(s, 7.25, 1.92, 5.1, 0.3, "SCORE AND RESCALE", size=10, bold=True, color=TEAL)
    text(s, 7.25, 2.28, 5.15, 0.45, "s(x) = 2^(\u2212E[h(x)] / c(\u03c8))", size=18,
         bold=True, color=WHITE, font=MONO)
    text(s, 7.25, 2.82, 5.15, 0.45, "s\u2032 = clamp((s \u2212 0.35) / 0.5, 0, 1)", size=18,
         bold=True, color=WHITE, font=MONO)
    bullets(s, 6.95, 3.65, 5.73, 2.7, [
        ("Why rescale:: raw isolation scores depend on sample shape and size, so they are not comparable between profiles.", 0),
        ("What it cannot do:: the score alone says nothing about which physical quantity moved.", 0),
        ("That is why fusion keeps a weighted robust term rather than trusting the forest alone.", 0),
    ], size=12.5, gap=9)
    notes(s, "Do not derive the path-length formula. Explain that isolation "
             "means fewer random splits are needed to separate an unusual "
             "point. Stress the deterministic seed: without it, every replay "
             "would produce a slightly different flag count and no report could "
             "be checked.")


def slide_fusion(prs, n):
    s = prs.slides.add_slide(prs.slide_layouts[6])
    header(s, "PART 2  \u00b7  FUSION AND DECISION", "Two signals, three states, no probability",
           M2, n)
    bullets(s, 0.65, 1.72, 5.6, 2.4, [
        ("Robust term:: z = clamp((|zT|/4 + |zH|/4 + |zP|/3) / 3, 0, 1).", 0),
        ("Fusion:: a = 0.7 s\u2032 + 0.3 z when a profile exists, otherwise z alone.", 0),
        ("States:: Healthy below 0.32, Warning to 0.62, Critical above it, all configurable.", 0),
    ], size=13, gap=10)
    table(s, 6.55, 1.80, 6.13, [
        ["Case", "z", "s", "a", "Status"],
        ["1  temperature only", "0.33", "0.55", "0.38", "Warning"],
        ["2  + humidity", "0.58", "0.58", "0.49", "Warning"],
        ["3  + pressure \u22127.5", "1.00", "0.60", "0.72", "Critical"],
    ], [2.28, 0.78, 0.78, 0.78, 1.28], size=11, row_h=0.40,
        align_right=(1, 2, 3), bold_first=True)
    text(s, 6.55, 3.42, 6.13, 0.35,
         "Fixed profile: 25.0 \u00b0C, 60 %, 1005 hPa. Illustrative arithmetic, not measurements.",
         size=9.5, italic=True, color=GREY)
    card = rect(s, 0.65, 4.30, 12.03, 1.35, CARD, radius=0.05)
    text(s, 0.95, 4.50, 3.0, 0.3, "HEALTH INDEX", size=10, bold=True, color=TEAL)
    text(s, 0.95, 4.80, 5.4, 0.45, "health = clamp(round(100 \u2212 65a), 20, 100)",
         size=17, bold=True, color=NAVY, font=MONO)
    bullets(s, 6.55, 4.52, 5.9, 1.0, [
        ("Kept for continuity with earlier dashboards, not as a physical measurement.", 0),
        ("confidence is returned as null: a field so named would be read as calibrated whether or not it is.", 0),
    ], size=11, gap=5)
    text(s, 0.65, 5.90, 12.03, 0.7,
         "The absence of Critical flags in our replay is not a success: a detector that rarely escalates provides no prioritisation.",
         size=12, color=GREY, align=PP_ALIGN.CENTER)
    notes(s, "Walk through case 1 to case 3 quickly, pointing out that the "
             "forest contributes most in case 1 and the robust term decides "
             "case 3. Then say plainly: none of these numbers is a probability, "
             "and the API refuses to label it one. Hand-off to the network-level "
             "check and slow faults.")

#!/usr/bin/env python3
"""Build data/graph-data.json from the two source tables in data/.

    python3 scripts/build_data.py

Source tables (edit these, then rebuild):
  data/universities.csv  one row per faculty (key, names, region, source link, notes ES/EN)
  data/subjects.csv      one row per subject: university key, year, semester, subject, type, ECTS

Every subject is tagged with one or more disciplines by matching its name
(Spanish, Catalan, Basque-Spanish variants) against the rules below. Its ECTS
are split equally between the disciplines it matches. Placements, final
projects and electives get their own nodes whatever their name.
"""
import csv
import json
import re
import sys
import unicodedata
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TYPES = ("FB", "OB", "OP", "PE", "TFG")

# key, group, Spanish name, English name, pattern (accent-free, lowercase)
DISCIPLINES = [
    ("anatomy", "basic", "Anatomía", "Anatomy", r"anatom(?!ia patol)|esplacnolog|morfolog|estructura (y|i) funci|embriolog|neuroanatom|(?<!an)estesiolog"),
    ("histology", "basic", "Histología", "Histology", r"histolog|organograf|estructura microscop"),
    ("cell-biology", "basic", "Biología celular", "Cell biology", r"(^|[^o])biolog(?!ia molecular)|celul|cellular|citolog|celulas madre|cellules mare|ciencias de la vida ii"),
    ("biochemistry", "basic", "Bioquímica y Biol. molecular", "Biochemistry & molecular biology", r"bioquim(?!ica clinica)|biologia molecular|metabolismo celular|ciencias de la vida (i|iii)\b|bases moleculares"),
    ("physiology", "basic", "Fisiología", "Physiology", r"fisiolog|neurobiolog|homeostasi|neurociencias basicas"),
    ("genetics", "basic", "Genética", "Genetics", r"genet|genom|herencia"),
    ("immunology", "basic", "Inmunología", "Immunology", r"inmunolog|immunolog|sistema immune|sistema inmune"),
    ("microbiology", "basic", "Microbiología", "Microbiology", r"microbio|parasit"),
    ("medical-physics", "basic", "Física médica", "Medical physics", r"(?<!medicina )(?<!terapeutica )fisic(a|o)[ -]|(?<!medicina )(?<!terapeutica )fisica$|fisica\.|biofisic|fisica medica"),
    ("pharmacology", "basic", "Farmacología", "Pharmacology", r"farmac|terapeutica (medica|general)|procedimientos terapeuticos"),
    ("biostatistics", "methods", "Bioestadística", "Biostatistics", r"estadist|matematic|bioinformat|manejo de datos|maneig de dades"),
    ("epidemiology", "methods", "Epidemiología", "Epidemiology", r"epidemiolog"),
    ("research", "methods", "Investigación", "Research methods", r"investig|recerca|metodolog|evidencia|metodo cientific|proyecto|precisio"),
    ("humanities", "humanities", "Historia y humanidades", "History & humanities", r"histori|human(is|idad)|introduccio a les ciencies|ciencia medica|antropolog|sociedad|social|documentaci|informatic|universidad, salud|introduccio(n)? a la medicina|introducci(o|on) a l.estudi|valores|narrativa|nuevas tecnolog|noves tecnolog|telemedicina|inteligencia artificial|ia en medicina|ambitos de actuacion"),
    ("ethics", "humanities", "Ética y legislación", "Ethics & law", r"etic|deontolog|profesional|derecho|legislac|bases legales"),
    ("communication", "humanities", "Comunicación", "Communication", r"comunicac|comunicacio|relacion medico|competencia emocional"),
    ("english", "humanities", "Inglés", "English", r"ingles|angles|english"),
    ("psychology", "humanities", "Psicología", "Psychology", r"psicolog"),
    ("general-pathology", "clinical", "Patología general", "General pathology & semiology", r"patologia general|semiolog|propedeut|fisiopatolog|introduccion a la (clinica|practica)|introduccio a la clinica|examen clinic|habilidades|habilitats|medicina interna|bases de la medicina|fundamentos del diagnostico|fundamentos de medicina clinica|aplicacion clinica|integracio|integracion|integrada|enfermo pluripatol|patologia medica (i|ii|iii|iv|v|vi)\b|patologia y clinica medica|parametros vitales|aprenentatge integrat|asistencia|organos y sistemas|ambitos clinicos|procedimientos diagnosticos"),
    ("pathology", "clinical", "Anatomía patológica", "Pathology", r"anatomia patolog|patologia estructural|patologia tumoral|patologia molecular"),
    ("radiology", "clinical", "Radiología", "Radiology", r"radiolog|imagen|imatge|radiodiagn|medicina nuclear|diagnostico por"),
    ("laboratory", "clinical", "Laboratorio clínico", "Clinical laboratory", r"bioquimica clinica|laboratorio|analisis clini"),
    ("surgery", "clinical", "Cirugía", "Surgery", r"cirug|cirurg|quirurg|trasplant|maxilofacial"),
    ("anaesthesia", "clinical", "Anestesia y crítico", "Anaesthesia & critical care", r"anestes|reanimac|dolor|critic|intensiv|politraum"),
    ("emergency", "clinical", "Urgencias", "Emergency medicine", r"soporte vital|urgenc|emergenc|urgen"),
    ("cardiovascular", "systems", "Cardiovascular", "Cardiovascular", r"cardio|circulatori|vascular"),
    ("respiratory", "systems", "Respiratorio", "Respiratory", r"respirat|neumolog|pneumolog|torac|respiracio"),
    ("digestive", "systems", "Digestivo", "Digestive", r"digest|gastro|abdom"),
    ("nephro-urology", "systems", "Nefrología y urología", "Nephrology & urology", r"nefro|urolog|urinar|renal|genitourin|genito-urin|excrecio|electrolits"),
    ("neurology", "systems", "Neurología", "Neurology", r"neurolog|nervios|neurocirug|cervell|neurocien.*clinic"),
    ("endocrinology", "systems", "Endocrinología y nutrición", "Endocrinology & nutrition", r"endocr|nutric|nutricio|dietet|dietoter|hormon"),
    ("haematology", "systems", "Hematología", "Haematology", r"hemato|sangre|\bsang\b|sanguin|limfatic"),
    ("oncology", "systems", "Oncología", "Oncology", r"oncolog|cancer|tumoral|radioterap"),
    ("infectious", "systems", "Infecciosas", "Infectious diseases", r"infecci|infeccio|zoonot"),
    ("rheumatology", "systems", "Reumatología e inmunopatología", "Rheumatology & immunopathology", r"reumat|autoinmun|autoimmun|inmunopat|alerg|sistemic|inmunologia clinica|sistematiques"),
    ("musculoskeletal", "systems", "Locomotor y traumatología", "Musculoskeletal & trauma", r"locomotor|traumat|ortoped|osteo|musculoesq|suport i moviment"),
    ("dermatology", "senses", "Dermatología", "Dermatology", r"dermat|piel|\bpell\b"),
    ("ophthalmology", "senses", "Oftalmología", "Ophthalmology", r"oftalm|ocular"),
    ("ent", "senses", "Otorrinolaringología", "ENT", r"otorrin|otorin|oticas|cervico"),
    ("paediatrics", "lifecycle", "Pediatría", "Paediatrics", r"pediatr|infancia|neonat|naixement|materno-infantil|infantil"),
    ("obgyn", "lifecycle", "Obstetricia y ginecología", "Obstetrics & gynaecology", r"obstetr|ginecol|reproducc"),
    ("psychiatry", "lifecycle", "Psiquiatría", "Psychiatry", r"psiquiatr|salud mental|conducta humana|psicopatol"),
    ("legal-medicine", "public", "Medicina legal y toxicología", "Legal medicine & toxicology", r"legal|forense|toxicolog|toxico"),
    ("public-health", "public", "Salud pública", "Public health", r"preventiv|salud publica|salut publica|gestion|gestio|demograf|salud laboral|salut laboral|ambiental"),
    ("family-medicine", "public", "Medicina de familia", "Family medicine", r"familia|comunitari|atencion primaria|atencio primaria|enfermedad cronica|cronicitat"),
    ("geriatrics", "public", "Geriatría y paliativos", "Geriatrics & palliative care", r"geriatr|gerontolog|envelliment|paciente mayor|paliativ|vulnerable"),
    ("rehabilitation", "public", "Rehabilitación", "Rehabilitation", r"rehabilit|medicina fisica|terapeutica fisica"),
    ("placements", "training", "Prácticas clínicas", "Clinical placements", None),
    ("final-project", "training", "TFG", "Final project (TFG)", None),
    ("electives", "training", "Optativas", "Electives", None),
    ("other", "training", "Otras", "Other", None),
]
BASIC = {"anatomy", "histology", "physiology", "biochemistry", "cell-biology"}
ORGAN = {d[0] for d in DISCIPLINES if d[1] in ("systems", "senses")}
KEYS = [d[0] for d in DISCIPLINES]
PATTERNS = [(d[0], re.compile(d[4])) for d in DISCIPLINES if d[4]]


def norm(s: str) -> str:
    s = unicodedata.normalize("NFD", s.lower())
    s = "".join(c for c in s if unicodedata.category(c) != "Mn")
    return s.replace("·", "").replace("'", " ")


def classify(name: str, kind: str) -> list[str]:
    """Return the discipline keys a subject belongs to."""
    n = norm(name)
    if kind == "PE" or re.search(r"practica clinica|practica assist|practiques assist|taller de practica|practicas (medico|de proced|en centro)", n):
        return ["placements"]
    if kind == "TFG":
        return ["final-project"]
    if kind == "OP" or n.startswith("optativ") or "optatividad" in n or "reconocimiento" in n or "reconeixement" in n:
        return ["electives"]
    n = n.replace("[materia]", "")
    found = [k for k, p in PATTERNS if p.search(n)]
    if "pathology" in found and "anatomy" in found:
        found.remove("anatomy")
    if any(k in BASIC for k in found):  # basic sciences of a system are not clinical organ subjects
        found = [k for k in found if k not in ORGAN]
    return found or ["other"]


def years(value: str) -> list[int]:
    value = value.strip()
    if value.isdigit():
        return [int(value)]
    m = re.fullmatch(r"(\d)-(\d)", value)
    if m:
        return list(range(int(m[1]), int(m[2]) + 1))
    return [1, 2, 3, 4, 5, 6]  # "any"


def main() -> int:
    with open(ROOT / "data/universities.csv", newline="", encoding="utf-8") as f:
        unis = list(csv.DictReader(f))
    index = {u["key"]: i for i, u in enumerate(unis)}
    rows, unmatched = [], []
    with open(ROOT / "data/subjects.csv", newline="", encoding="utf-8") as f:
        for r in csv.DictReader(f):
            if r["type"] not in TYPES:
                raise SystemExit(f"Unknown type {r['type']!r} in {r}")
            ects = float(r["ects"])
            ds = classify(r["subject"], r["type"])
            if ds == ["other"]:
                unmatched.append(f"{r['university']}: {r['subject']}")
            rows.append([index[r["university"]], years(r["year"]), r["semester"], r["subject"], r["type"],
                         int(ects) if ects.is_integer() else ects, [KEYS.index(d) for d in ds]])
    out = {
        "universities": [{
            "key": u["key"], "short": u["short"], "name": u["name"], "region": u["region"], "campus": u["campus"],
            "url": u["source_url"], "version": {"es": u["version_es"], "en": u["version_en"]},
            "notes": {"es": u["notes_es"], "en": u["notes_en"]},
        } for u in unis],
        "disciplines": [{"key": d[0], "group": d[1], "es": d[2], "en": d[3]} for d in DISCIPLINES],
        "rows": rows,
    }
    (ROOT / "data/graph-data.json").write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"{len(unis)} universities, {len(rows)} subjects, {len(unmatched)} unmatched")
    for u in unmatched:
        print("  unmatched:", u)
    return 0


if __name__ == "__main__":
    sys.exit(main())

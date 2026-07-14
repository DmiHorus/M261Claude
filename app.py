import time
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta, timezone

import requests
from flask import Flask, jsonify, render_template, abort

app = Flask(__name__)

CBR_DAILY_URL = "https://www.cbr.ru/scripts/XML_daily.asp"
CBR_DYNAMIC_URL = "https://www.cbr.ru/scripts/XML_dynamic.asp"

# Curated set of currencies shown on the dashboard, with their stable CBR
# internal identifiers (confirmed against the live daily feed).
CURRENCIES = [
    ("USD", "R01235", "Доллар США"),
    ("EUR", "R01239", "Евро"),
    ("GBP", "R01035", "Фунт стерлингов"),
    ("CNY", "R01375", "Китайский юань"),
    ("JPY", "R01820", "Японская иена"),
    ("CHF", "R01775", "Швейцарский франк"),
    ("TRY", "R01700J", "Турецкая лира"),
    ("KZT", "R01335", "Казахстанский тенге"),
    ("BYN", "R01090B", "Белорусский рубль"),
    ("AMD", "R01060", "Армянский драм"),
    ("INR", "R01270", "Индийская рупия"),
    ("AED", "R01230", "Дирхам ОАЭ"),
]
CODE_TO_ID = {code: id_ for code, id_, _ in CURRENCIES}
CODE_TO_NAME = {code: name for code, _, name in CURRENCIES}

RATES_TTL = 600  # seconds; CBR publishes once a day, no need to hammer it
HISTORY_TTL = 600

_cache = {}


def _cache_get(key):
    hit = _cache.get(key)
    if hit and time.time() - hit[0] < hit[2]:
        return hit[1]
    return None


def _cache_set(key, value, ttl):
    _cache[key] = (time.time(), value, ttl)


def fetch_history(cbr_id, days):
    """Fetch daily rate history for a single CBR currency id over the last `days` days."""
    cache_key = ("history", cbr_id, days)
    cached = _cache_get(cache_key)
    if cached is not None:
        return cached

    date_to = datetime.now(timezone.utc)
    # CBR only publishes on business days: pad the window generously so `days`
    # trading-day points are actually available after weekends/holidays.
    date_from = date_to - timedelta(days=int(days * 1.6) + 10)
    params = {
        "date_req1": date_from.strftime("%d/%m/%Y"),
        "date_req2": date_to.strftime("%d/%m/%Y"),
        "VAL_NM_RQ": cbr_id,
    }
    resp = requests.get(CBR_DYNAMIC_URL, params=params, timeout=10)
    resp.raise_for_status()
    root = ET.fromstring(resp.content)

    points = []
    for record in root.findall("Record"):
        date_str = record.get("Date")
        nominal = int(record.findtext("Nominal", "1"))
        value = float(record.findtext("Value", "0").replace(",", "."))
        d = datetime.strptime(date_str, "%d.%m.%Y")
        points.append({
            "date": d.strftime("%Y-%m-%d"),
            "value": round(value / nominal, 6),
        })

    points = points[-days:]
    _cache_set(cache_key, points, HISTORY_TTL)
    return points


def build_rates():
    cache_key = ("rates",)
    cached = _cache_get(cache_key)
    if cached is not None:
        return cached

    rows = []
    for code, cbr_id, name in CURRENCIES:
        try:
            points = fetch_history(cbr_id, 30)
        except (requests.RequestException, ET.ParseError):
            continue
        if not points:
            continue
        current = points[-1]
        previous = points[-2] if len(points) > 1 else current
        delta = round(current["value"] - previous["value"], 6)
        delta_pct = round((delta / previous["value"]) * 100, 3) if previous["value"] else 0
        rows.append({
            "char_code": code,
            "name": name,
            "value": current["value"],
            "date": current["date"],
            "prev_value": previous["value"],
            "delta": delta,
            "delta_pct": delta_pct,
        })

    result = {
        "updated_at": datetime.now(timezone.utc).isoformat(),
        "rates": rows,
    }
    _cache_set(cache_key, result, RATES_TTL)
    return result


@app.route("/")
def index():
    return render_template("index.html")


@app.route("/api/rates")
def api_rates():
    return jsonify(build_rates())


@app.route("/api/history/<code>")
def api_history(code):
    from flask import request
    code = code.upper()
    if code not in CODE_TO_ID:
        abort(404, description="Unknown currency code")
    days = request.args.get("days", default=30, type=int)
    days = max(7, min(days, 90))
    try:
        points = fetch_history(CODE_TO_ID[code], days)
    except (requests.RequestException, ET.ParseError):
        abort(502, description="CBR API unavailable")
    return jsonify({
        "char_code": code,
        "name": CODE_TO_NAME[code],
        "points": points,
    })


if __name__ == "__main__":
    app.run(debug=True, port=5000)

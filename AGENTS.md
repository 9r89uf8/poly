no typescript
no ESL lint
no running build command

Below is the **combined, full end‑to‑end plan**

## 0) Manifesto: what we’re building

You’re building an **Oracle Terminal** for temperature markets:

A web dashboard that tells you—**fast and reliably**:

1. **What the oracle will likely print** (Weather Underground–aligned, integer °F, calibrated)
2. **Today’s high so far** (the only state variable that matters for settlement)
3. **Which Polymarket bins are now dead** (hard eliminations)
4. Whether your feed is **healthy or broken** (broken = don’t trade)

### What it is not

* Not an order bot (you trade manually).
* Not a traditional weather app.
* Not “true runway physics.” It’s **oracle‑aligned intelligence**.

### North star

**Trade the oracle, not the atmosphere.**
WU is the settlement source, and WU describes airport ASOS observations as “updated hourly, or more frequently when adverse weather affecting aviation occurs.” ([Weather Underground][1])

---

## 1) Oracle definition: what settles this market

From your rules:

* **Station:** Chicago O’Hare Intl Airport Station (KORD)
* **Metric:** highest temperature recorded on the date
* **Precision:** whole degrees Fahrenheit
* **Resolution source:** Weather Underground daily history page (finalized)

This creates one big implication:

> Your “truth” is **WU’s final daily high**, not whatever a different weather app or the ASOS phone line said intraday.

---
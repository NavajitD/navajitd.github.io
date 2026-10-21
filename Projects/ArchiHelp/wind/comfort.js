// ArchiHelp wind — thermal comfort: SET (Gagge two-node model, as ASHRAE 55 / pythermalcomfort), psychrometrics,
// clothing by outdoor temperature, adaptive comfort bands (IMAC for India, ASHRAE 55 elsewhere) and the elevated-air-
// speed allowance. "Feels like" in the app is SET: one temperature that folds in radiant heat, humidity and air speed.
const pSatTorr = (t) => Math.exp(18.6686 - 4030.183 / (t + 235.0));

/** Saturation vapour pressure, Pa (Magnus over water). */
export const pSat = (t) => 610.94 * Math.exp(17.625 * t / (t + 243.04));
/** Relative humidity (%) of air at temperature t whose dew point is td. */
export const rhFromDew = (t, td) => Math.max(1, Math.min(100, 100 * pSat(td) / pSat(t)));

/**
 * Standard Effective Temperature (deg C). Line-for-line port of pythermalcomfort's _gagge_two_nodes_optimized (SET part).
 * tdb air, tr mean radiant (deg C), v air speed (m/s), rh (%), met, clo; position 'standing' | 'sitting'.
 */
export function setTmp(tdb, tr, v, rh, met, clo, { wme = 0, bsa = 1.8258, pAtm = 101325, position = 'standing', calculateCe = false } = {}) {
  const vaporPressure = rh * pSatTorr(tdb) / 100;
  const airSpeed = Math.max(v, 0.1), kClo = 0.25, bodyWeight = 70, metFactor = 58.2, sbc = 0.000000056697;
  const cSw = 170, cDil = 120, cStr = 0.5, tSkN = 33.7, tCrN = 36.8;
  let alfa = 0.1;
  const tBodyN = alfa * tSkN + (1 - alfa) * tCrN, sbfN = 6.3;
  let tSkin = tSkN, tCore = tCrN, mBl = sbfN, eSkin = 0.1 * met, qSens = 0, w = 0, eRsw = 0, eDiff = 0, eMax = 0, mRsw = 0;
  const pAtmAt = pAtm / 101325, lsim = 60;
  let nSim = 1;
  const rClo = 0.155 * clo, faCl = 1.0 + 0.15 * clo, lr = 2.2 / pAtmAt, rm = (met - wme) * metFactor;
  let m = met * metFactor;
  const iCl = clo > 0 ? 0.45 : 1.0;
  let wMax = 0.38 * airSpeed ** -0.29; if (clo > 0) wMax = 0.59 * airSpeed ** -0.08;
  let hCc = 3.0 * pAtmAt ** 0.53;
  const hFc = 8.600001 * (airSpeed * pAtmAt) ** 0.53;
  hCc = Math.max(hCc, hFc);
  if (!calculateCe && met > 0.85) hCc = Math.max(hCc, 5.66 * (met - 0.85) ** 0.39);
  let hR = 4.7, hT = hR + hCc, rA = 1.0 / (faCl * hT), tOp = (hR * tr + hCc * tdb) / hT;
  const qRes = 0.0023 * m * (44.0 - vaporPressure), cRes = 0.0014 * m * (34.0 - tdb);
  const radFrac = position === 'sitting' ? 0.7 : 0.73;
  while (nSim < lsim) {
    nSim++;
    let tCl = (rA * tSkin + rClo * tOp) / (rA + rClo), it = 0, ok = false;
    while (!ok) {
      hR = 4.0 * 0.95 * sbc * ((tCl + tr) / 2.0 + 273.15) ** 3.0 * radFrac;
      hT = hR + hCc; rA = 1.0 / (faCl * hT); tOp = (hR * tr + hCc * tdb) / hT;
      const tn = (rA * tSkin + rClo * tOp) / (rA + rClo);
      if (Math.abs(tn - tCl) <= 0.01) ok = true;
      tCl = tn; it++;
      if (it > 150) throw new Error('SET: max iterations exceeded');
    }
    qSens = (tSkin - tOp) / (rA + rClo);
    const hfCs = (tCore - tSkin) * (5.28 + 1.163 * mBl);
    const sCore = m - hfCs - qRes - cRes - wme, sSkin = hfCs - qSens - eSkin;
    const tcSk = 0.97 * alfa * bodyWeight, tcCr = 0.97 * (1 - alfa) * bodyWeight;
    tSkin += sSkin * bsa / (tcSk * 60.0);
    tCore += sCore * bsa / (tcCr * 60.0);
    const tBody = alfa * tSkin + (1 - alfa) * tCore;
    const skSig = tSkin - tSkN, warmSk = skSig > 0 ? skSig : 0, colds = -skSig > 0 ? -skSig : 0;
    const cReg = tCore - tCrN, cWarm = cReg > 0 ? cReg : 0, cCold = -cReg > 0 ? -cReg : 0;
    const bd = tBody - tBodyN, warmB = bd > 0 ? bd : 0;
    mBl = (sbfN + cDil * cWarm) / (1 + cStr * colds);
    mBl = Math.max(Math.min(mBl, 90), 0.5);
    mRsw = Math.min(cSw * warmB * Math.exp(warmSk / 10.7), 500);
    eRsw = 0.68 * mRsw;
    const rEa = 1.0 / (lr * faCl * hCc), rEcl = rClo / (lr * iCl);
    eMax = (pSatTorr(tSkin) - vaporPressure) / (rEa + rEcl);
    if (eMax === 0) eMax = 0.001;
    let pRsw = eRsw / eMax;
    w = 0.06 + 0.94 * pRsw;
    eDiff = w * eMax - eRsw;
    if (w > wMax) { w = wMax; pRsw = wMax / 0.94; eRsw = pRsw * eMax; eDiff = 0.06 * (1.0 - pRsw) * eMax; }
    if (eMax < 0) { eDiff = 0; eRsw = 0; w = wMax; }
    eSkin = eRsw + eDiff;
    mRsw = eRsw / 0.68;
    m = rm + 19.4 * colds * cCold;
    alfa = 0.0417737 + 0.7451833 / (mBl + 0.585417);
  }
  const qSkin = qSens + eSkin, pSSk = pSatTorr(tSkin);
  const hRs = hR;
  let hCs = 3.0 * pAtmAt ** 0.53;
  if (!calculateCe && met > 0.85) hCs = Math.max(hCs, 5.66 * (met - 0.85) ** 0.39);
  hCs = Math.max(hCs, 3.0);
  const hTs = hCs + hRs, rCloS = 1.52 / ((met - wme / metFactor) + 0.6944) - 0.1835, rClS = 0.155 * rCloS;
  const faClS = 1.0 + kClo * rCloS, fClS = 1.0 / (1.0 + 0.155 * faClS * hTs * rCloS), iMs = 0.45;
  const iClS = iMs * hCs / hTs * (1 - fClS) / (hCs / hTs - fClS * iMs);
  const rAs = 1.0 / (faClS * hTs), rEas = 1.0 / (lr * faClS * hCs), rEcls = rClS / (lr * iClS);
  const hDs = 1.0 / (rAs + rClS), hEs = 1.0 / (rEas + rEcls);
  const delta = 0.0001;
  let dx = 100.0, setOld = Math.round((tSkin - qSkin / hDs) * 100) / 100, set = setOld;
  for (let guard = 0; Math.abs(dx) > 0.01 && guard < 200; guard++) {
    const e1 = qSkin - hDs * (tSkin - setOld) - w * hEs * (pSSk - 0.5 * pSatTorr(setOld));
    const e2 = qSkin - hDs * (tSkin - (setOld + delta)) - w * hEs * (pSSk - 0.5 * pSatTorr(setOld + delta));
    set = setOld - delta * e1 / (e2 - e1);
    dx = set - setOld; setOld = set;
  }
  return set;
}

/** Clothing insulation (clo) from the outdoor temperature at 6 a.m. (Schiavon & Lee 2013, ASHRAE 55). */
export function cloFromT6(t6) {
  if (t6 < -5) return 1.0;
  if (t6 < 5) return 0.818 - 0.0364 * t6;
  if (t6 < 26) return 10 ** (-0.1635 - 0.0066 * t6);
  return 0.46;
}

/**
 * Adaptive comfort band for naturally ventilated homes: IMAC (India, NBC 2016: 0.54 x 30-day running mean + 12.83,
 * 90 % acceptability +-2.38 K) for South Asia, ASHRAE 55 (0.31 x prevailing mean + 17.8, 80 % +-3.5 K) elsewhere.
 * -> { model, neutral, lo, hi }
 */
export function adaptiveBand(meanOutdoor, { india = true } = {}) {
  if (india) { const t = Math.max(12.5, Math.min(31, meanOutdoor)), n = 0.54 * t + 12.83; return { model: 'IMAC (NBC 2016), 90 %', neutral: n, lo: n - 2.38, hi: n + 2.38 }; }
  const t = Math.max(10, Math.min(33.5, meanOutdoor)), n = 0.31 * t + 17.8;
  return { model: 'ASHRAE 55 adaptive, 80 %', neutral: n, lo: n - 3.5, hi: n + 3.5 };
}

/** ASHRAE 55 elevated-air-speed extension of the upper limit (K) at operative temperatures above 25 C. */
export function airSpeedAllowance(v) {
  if (v < 0.6) return 0;
  if (v < 0.9) return 1.2 + (v - 0.6) / 0.3 * 0.6;
  if (v < 1.2) return 1.8 + (v - 0.9) / 0.3 * 0.4;
  return 2.2;
}

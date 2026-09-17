/**
 * What counts as a currency code in front of a figure.
 *
 * A three-letter prefix is *not* enough: "Des 2024", "Mei 2024", "Agu 2024" and "Okt 2024" are month
 * headers, and reading them as a currency turned a whole year of columns into the number 2024. A code
 * has to be on the real ISO-4217 list, and a month name in either language is never one.
 */

/** Active ISO-4217 alphabetic codes, including the X* funds and metals we might still see. */
const ISO_4217 = new Set(
  (
    "AED AFN ALL AMD ANG AOA ARS AUD AWG AZN BAM BBD BDT BGN BHD BIF BMD BND BOB BOV BRL BSD BTN BWP " +
    "BYN BZD CAD CDF CHE CHF CHW CLF CLP CNY COP COU CRC CUP CVE CZK DJF DKK DOP DZD EGP ERN ETB EUR " +
    "FJD FKP GBP GEL GHS GIP GMD GNF GTQ GYD HKD HNL HTG HUF IDR ILS INR IQD IRR ISK JMD JOD JPY KES " +
    "KGS KHR KMF KPW KRW KWD KYD KZT LAK LBP LKR LRD LSL LYD MAD MDL MGA MKD MMK MNT MOP MRU MUR MVR " +
    "MWK MXN MXV MYR MZN NAD NGN NIO NOK NPR NZD OMR PAB PEN PGK PHP PKR PLN PYG QAR RON RSD RUB RWF " +
    "SAR SBD SCR SDG SEK SGD SHP SLE SOS SRD SSP STN SVC SYP SZL THB TJS TMT TND TOP TRY TTD TWD TZS " +
    "UAH UGX USD USN UYI UYU UYW UZS VED VES VND VUV WST XAF XAG XAU XCD XCG XDR XOF XPF XPT XSU XUA " +
    "YER ZAR ZMW ZWG"
  ).split(" "),
);

/** Month names in both languages, long and short, so none of them is ever read as a code. */
const MONTH_NAMES = new Set(
  (
    "jan januari january feb februari february mar maret march apr april mei may jun juni june " +
    "jul juli july agu ags agt agustus aug august sep sept september okt oktober oct october " +
    "nov november des desember dec december"
  ).split(" "),
);

/** True for a month name in Indonesian or English, long or short. */
export function isMonthWord(text: string): boolean {
  return MONTH_NAMES.has(text.trim().toLowerCase().replace(/\.$/, ""));
}

/** True only for a code on the ISO-4217 list that is not also a month name. */
export function isCurrencyCode(text: string): boolean {
  const code = text.trim().toUpperCase();
  return code.length === 3 && ISO_4217.has(code) && !isMonthWord(code);
}

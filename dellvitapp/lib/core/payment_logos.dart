import '../models/models.dart';
import 'config.dart';

/// Provider logos are the same pictures the website serves from `/paymentmethods/<slug>.png`.
const _slugs = <String, String>{
  'National Bank of Pakistan': 'nbp',
  'The Bank of Punjab': 'bank-of-punjab',
  'Bank of Khyber': 'bank-of-khyber',
  'Sindh Bank': 'sindh-bank',
  'First Women Bank': 'first-women-bank',
  'Allied Bank': 'allied-bank',
  'Askari Bank': 'askari-bank',
  'Bank Alfalah': 'bank-alfalah',
  'Bank Al Habib': 'bank-al-habib',
  'Bank Makramah': 'bank-makramah',
  'Faysal Bank': 'faysal-bank',
  'Habib Bank Limited (HBL)': 'hbl',
  'Habib Metropolitan Bank': 'habib-metro',
  'JS Bank': 'js-bank',
  'MCB Bank': 'mcb',
  'Samba Bank': 'samba-bank',
  'Silkbank': 'silkbank',
  'Soneri Bank': 'soneri-bank',
  'Standard Chartered': 'standard-chartered',
  'United Bank Limited (UBL)': 'ubl',
  'Meezan Bank': 'meezan-bank',
  'BankIslami': 'bankislami',
  'Dubai Islamic Bank': 'dubai-islamic-bank',
  'Al Baraka Bank': 'al-baraka-bank',
  'MCB Islamic Bank': 'mcb-islamic',
  'Citibank': 'citibank',
  'Deutsche Bank': 'deutsche-bank',
  'Bank of China': 'bank-of-china',
  'ICBC': 'icbc',
  'Zarai Taraqiati Bank (ZTBL)': 'ztbl',
  'SME Bank': 'sme-bank',
  'Punjab Provincial Cooperative Bank': 'ppcbl',
  'Easypaisa Bank': 'easypaisa-bank',
  'Mashreq Bank Pakistan': 'mashreq-bank',
  'Raqami Islamic Digital Bank': 'raqami-bank',
  'Mobilink Microfinance Bank': 'mobilink-microfinance-bank',
  'Khushhali Microfinance Bank': 'khushhali-bank',
  'HBL Microfinance Bank': 'hbl-microfinance-bank',
  'The First MicroFinance Bank': 'first-microfinance-bank',
  'NRSP Microfinance Bank': 'nrsp-bank',
  'U Microfinance Bank': 'u-bank',
  'FINCA Microfinance Bank': 'finca-bank',
  'Pak Oman Microfinance Bank': 'pak-oman-microfinance-bank',
  'Sindh Microfinance Bank': 'sindh-microfinance-bank',
  'Apna Microfinance Bank': 'apna-microfinance-bank',
  'JazzCash': 'jazzcash',
  'Easypaisa': 'easypaisa',
  'SadaPay': 'sadapay',
  'NayaPay': 'nayapay',
  'UPaisa': 'upaisa',
  'Konnect by HBL': 'konnect',
  'Zindigi': 'zindigi',
  'SimSim': 'simsim',
  'MCB Lite': 'mcb-lite',
  'Alfa by Bank Alfalah': 'alfa',
};

/// The logo for a payment method: its provider's, or the one the administrator uploaded.
String paymentLogoUrl(PaymentMethod m) {
  String slug = '';
  if (m.type == 'cod') {
    slug = 'cash-on-delivery';
  } else if (m.type == 'raast') {
    slug = 'raast';
  } else {
    slug = _slugs[m.providerName] ?? '';
  }
  if (slug.isNotEmpty) return AppConfig.url('/paymentmethods/$slug.png');
  return AppConfig.url(m.logo);
}

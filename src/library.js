// The slokam library shown in the ☰ menu.
// Numbers follow the user's key. Each work is shown in its original script (Tamil or
// Devanagari) with IAST underneath. An entry with `text` (a key into window.SLOKAM_TEXTS, from src/texts/)
// and a recording (`youtube`) is playable; the others are reserved places for later.
window.SLOKAM_LIBRARY = [
  {
    id: 'divya', iast: 'divya prabandaṅgaḷ', native: 'திவ்ய ப்ரபந்தங்கள்', lang: 'ta',
    items: [
      { n: 1, iast: 'tirupallāṇḍu', native: 'திருப்பல்லாண்டு', text: 'tirupallandu', youtube: 'elIW-0wTHcI', duration: 443 },
      { n: 2, iast: 'tiruppaḷḷiyezucci', native: 'திருப்பள்ளியெழுச்சி', text: 'tiruppalliyezucci', youtube: 'VFFJvjro4eQ', duration: 327 },
      { n: 3, iast: 'tiruppāvai', native: 'திருப்பாவை', text: 'tiruppavai', youtube: 'tqrJueDJ1II' },
      { n: 4, iast: 'nīrāṭṭam', native: 'நீராட்டம்' },
      { n: 5, iast: 'pūccūṭṭal', native: 'பூச்சூட்டல்', text: 'puccuttal', youtube: 'NiM4ICBSkgw', duration: 193 },
      { n: 6, iast: 'kāppiḍal', native: 'காப்பிடல்', text: 'kappidal', youtube: 'cDV-Mo8n_kI', duration: 211 },
      { n: 7, iast: 'śenniyōṅgu', native: 'சென்னியோங்கு', text: 'senniyongu', youtube: 'DsbIQt550N8', duration: 250 },
      { n: 8, iast: 'amalanādipirān', native: 'அமலனாதிபிரான்', text: 'amalanadipiran', youtube: '84YaY3c6Z_g', duration: 261 },
      { n: 9, iast: 'kaṇṇinuṇ śiṟuttāmbu', native: 'கண்ணிநுண் சிறுத்தாம்பு', text: 'kanninun', youtube: 'ZidX8qMmfUs', duration: 225 },
      { n: 10, iast: 'irāmānuśa nūṟṟandādi', native: 'இராமாநுச நூற்றந்தாதி', text: 'ramanujanutrandadi', youtube: '-PkD67xhHf0' },
      {
        n: 11, iast: 'vāraṇamāyiram', native: 'வாரணமாயிரம்', text: 'varanamayiram', youtube: 'uKn6jYwQLrA',
        // the video is the whole of Nācciyār Tirumoḻi: its taniyan (0:00–0:21) and Vāraṇamāyiram (21:37–25:06)
        segments: [[0, 21], [1297, 1506]], duration: 230,
      },
      { n: 12, iast: 'tiruvezukūṟṟirukkai', native: 'திருவெழுகூற்றிருக்கை', text: 'tiruvezukurrirukkai', youtube: '5MPUwn8JafE' },
      { n: 13, iast: 'aṅgaṇ ñālam', native: 'அங்கண் ஞாலம்' },
      { n: 14, iast: 'kāśaiyāḍai', native: 'காசையாடை' },
      { n: 15, iast: 'vāṇilā muṟuval', native: 'வாணிலா முறுவல்' },
    ],
  },
  {
    id: 'desika-prabandham', iast: 'dēśika prabandaṅgaḷ', native: 'தேசிக ப்ரபந்தங்கள்', lang: 'ta',
    items: [
      { n: 16, iast: 'aḍaikkalappattu', native: 'அடைக்கலப்பத்து', text: 'adaikkalappattu', youtube: '0v2QxDExoAU' },
      {
        n: 17, iast: 'mummaṇikkōvai', native: 'மும்மணிக்கோவை',
        text: 'mummanikkovai', youtube: '_S8ixInldNY', duration: 416,
      },
      { n: 18, iast: 'navamaṇimālai', native: 'நவமணிமாலை', text: 'navamanimalai', youtube: 'tNa-YkfeeGA' },
      { n: 19, iast: 'adikārasaṅgraham', native: 'அதிகாரஸங்க்ரஹம்', text: 'adhikarasangraham', youtube: 'HArjuc4zkPs' },
      { n: 20, iast: 'śrī vaiṇavadinaśari', native: 'ஸ்ரீ வைணவ தினசரி', text: 'vaishnavadinasari', youtube: 'wW08-hGrcXg' },
      { n: 21, iast: 'prabandasāram', native: 'ப்ரபந்தஸாரம்', text: 'prabandhasaram', youtube: 'e_RE0UgoD98' },
      { n: 22, iast: 'piḷḷaiyandādi', native: 'பிள்ளையந்தாதி', text: 'pillaiyandadi', youtube: 'M-wqP9qrWUk' },
      { n: 23, iast: 'meyviradamānmiyam', native: 'மெய்விரதமான்மியம்', text: 'meyviradamanmiyam', youtube: 'fv3cNTJAc_Q' },
    ],
  },
  {
    id: 'desika-stotramala', iast: 'dēśika stōtramālā', native: 'देशिकस्तोत्रमाला', lang: 'sa',
    items: [
      { n: 24, iast: 'śrīhayagrīvastōtram', native: 'श्रीहयग्रीवस्तोत्रम्', text: 'hayagrivastotram', youtube: 'URLFjODqAoc' },
      { n: 25, iast: 'śrīdaśāvatārastōtram', native: 'श्रीदशावतारस्तोत्रम्', text: 'dasavatarastotram', youtube: 'LeH3SspGN5w' },
      { n: 26, iast: 'śrībhagavaddhyānasōpānam', native: 'श्रीभगवद्ध्यानसोपानम्', text: 'bhagavaddhyanasopanam', audio: 'https://www.prapatti.com/slokas/mp3/bhagavaddhyaanasopaanam.mp3' },
      { n: 27, iast: 'śrī abhītistavaḥ', native: 'श्री अभीतिस्तवः', text: 'abhitistava', youtube: 'mPJXXUF_lnk' },
      {
        n: 28, iast: 'śrīdayāśatakam', native: 'श्रीदयाशतकम्',
        text: 'dayasatakam', youtube: 'uFv0QOS2ROA',
      },
      { n: 29, iast: 'śrīvēgāsētustōtram', native: 'श्रीवेगासेतुस्तोत्रम्', text: 'vegasetustotram', audio: 'https://www.prapatti.com/slokas/mp3/vegaasetustotram.mp3' },
      { n: 30, iast: 'śrī aṣṭabhujāṣṭakam', native: 'श्री अष्टभुजाष्टकम्', text: 'ashtabhujashtakam', audio: 'https://www.prapatti.com/slokas/mp3/ashtabhujaashtakam.mp3' },
      { n: 31, iast: 'śrīkāmāsikāṣṭakam', native: 'श्रीकामासिकाष्टकम्', text: 'kamasikashtakam', youtube: 'zc0uAzv1B6Q' },
      { n: 32, iast: 'śrīparamārthastutiḥ', native: 'श्रीपरमार्थस्तुतिः', text: 'paramarthastuti', audio: 'https://www.prapatti.com/slokas/mp3/paramaarthastuti.mp3' },
      { n: 33, iast: 'śrī accuasaaam', native: 'श्री अच्चुअसअअं', text: 'accuasaam', youtube: 'aB1MQh0E678' },
      { n: 34, iast: 'śrīmahāvīravaibhavam (raghuvīra gadyam)', native: 'श्रीमहावीरवैभवम् (रघुवीरगद्यम्)', text: 'raghuviragadyam', youtube: 'pz_T4_MqNOc' },
      { n: 35, iast: 'śrīgōpālaviṃśatiḥ', native: 'श्रीगोपालविंशतिः', text: 'gopalavimsati', youtube: 'EIygjUa4xK8' },
      { n: 36, iast: 'śrīstutiḥ', native: 'श्रीस्तुतिः', text: 'sristuti', youtube: 'YagbUn2fZWw' },
      { n: 37, iast: 'śrībhūstutiḥ', native: 'श्रीभूस्तुतिः', text: 'bhustuti', youtube: 'uQf4CMbF0SY' },
      { n: 38, iast: 'śrīgōdāstutiḥ', native: 'श्रीगोदास्तुतिः', text: 'godastuti', youtube: 'KVdQ-VPiSbY' },
      { n: 39, iast: 'śrīnyāsadaśakam', native: 'श्रीन्यासदशकम्', text: 'nyasadasakam', youtube: '92vJYEn0X9Y' },
      { n: 40, iast: 'śrīsudarśanāṣṭakam', native: 'श्रीसुदर्शनाष्टकम्', text: 'sudarsanashtakam', youtube: 'rpd2QJeV54Y' },
      { n: 41, iast: 'śrī ṣōḍaśāyudhastōtram', native: 'श्री षोडशायुधस्तोत्रम्', text: 'shodasayudhastotram', youtube: 'VFGj8Y-oTDU' },
      { n: 42, iast: 'śrīgaruḍadaṇḍakaḥ', native: 'श्रीगरुडदण्डकः', text: 'garudadandakam', youtube: '_x3C37kE9Ug' },
      { n: 43, iast: 'śrīdēśikamaṅgaḷam', native: 'श्रीदेशिकमङ्गळम्', text: 'desikamangalam', youtube: '0zhWV393WPY' },
    ],
  },
  {
    id: 'vedam', iast: 'vēdam', native: 'वेदम्', lang: 'sa',
    items: [
      { n: 44, iast: 'puruṣasūktam', native: 'पुरुषसूक्तम्', text: 'purushasuktam', youtube: 'ga0cKR93P6w' },
      { n: 45, iast: 'viṣṇusūktam', native: 'विष्णुसूक्तम्', text: 'vishnusuktam', youtube: 'RiPlUn47R7U' },
      { n: 46, iast: 'nārāyaṇasūktam', native: 'नारायणसूक्तम्', text: 'narayanasuktam', youtube: '8OJWvbkjedQ' },
      { n: 47, iast: 'śrīsūktam', native: 'श्रीसूक्तम्', text: 'srisuktam', youtube: 'kX1zmwj5NrQ' },
      { n: 48, iast: 'bhūsūktam', native: 'भूसूक्तम्', text: 'bhusuktam', youtube: 'YCuo85TkFEA' },
      { n: 49, iast: 'nīḷāsūktam', native: 'नीळासूक्तम्', text: 'nilasuktam', youtube: 'ePOc-Pn1bpY' },
    ],
  },
];

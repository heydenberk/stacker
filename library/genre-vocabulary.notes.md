# Genre vocabulary: fold notes

The vocabulary in `genre-vocabulary.json` has 18 parents. They were built from `npm run genres:batch -- --stats` and from a skim of all 3,226 rated records.

These notes are for the tagging agents. A record gets 1–3 vocabulary genres, and its parents are derived with `parentsFor`.

## Shared genres
Three genres sit under two parents, on purpose:
- **Folk Rock** is under Rock and under Folk, Country & Blues.
- **Latin Jazz** is under Jazz and under Latin & Caribbean.
- **Samba-Jazz** is under Jazz and under Brazilian.

## Tagging rules of thumb
- **Umbrella tags.** MusicBrainz tags like `rock`, `pop`, `electronic`, `jazz`, `experimental`, `folk`, `punk`, `hip hop`, `latin`, `soul`, `blues` and `country` name a parent. They never name a genre. Use them to choose the parent, then pick the specific genre from what you know of the record.
- **Descriptors are not genres.** Ignore tags like `ballad`, `instrumental`, `dance`, `progressive`, `leftfield`, `piano rock`, `rock opera`, `male vocalist`, mood words and chart names when choosing genres.
- **Brazilian records.** MusicBrainz tags nearly every Brazilian record `latin`. Brazilian records go under **Brazilian**, never Latin & Caribbean.
  - Pick from Bossa Nova, Samba, MPB, Tropicália, Samba-Jazz, Samba Soul, Samba-Rock, Jovem Guarda and Psicodelia Brasileira.
  - Use **Psicodelia Brasileira** for early-70s Northeastern and underground psych: Marconi Notaro, Lula Côrtes, Damião Experiença, Paulo Bagunça, Guilherme Lamounier and Os Lobos.
  - Use **Jovem Guarda** for 60s Brazilian beat and pop-rock: Os Incríveis, Ronnie Von, Os Megatons, The Beatniks and Os Brazões.
  - Use **Samba-Rock** for Jorge Ben-style swing.
- **African records.** Most of them are Fela, so use **Afrobeat**. Use **Afro-Funk** for the 70s West African funk comps and for Poly-Rythmo.
  - These fold into broader genres:
    - jùjú → Highlife;
    - mbalax → Highlife;
    - South African jazz → Afro-Funk or Spiritual Jazz;
    - soukous → Congolese Rumba.
  - Tinariwen and Gordon Koang go under Desert Blues.
- **Reggae** sits under Latin & Caribbean. Use Roots Reggae, Dub or Ska.
  - rocksteady → Roots Reggae;
  - 2 tone → Ska;
  - dancehall → Dub, or Roots Reggae.
  - Linton Kwesi Johnson's dub poetry goes under Dub Poetry, in Spoken Word & Comedy.
- **Regional pop.**
  - 60s French girl-pop → Yé-yé. Gainsbourg and Brel → Chanson.
  - Faye Wong and other C-pop or Cantopop → Mandopop.
  - Flipper's Guitar, Cornelius and Pizzicato Five → Shibuya-kei.
  - Turkish 70s psych → Anatolian Rock.
  - Fishmans → Dream Pop and Dub.
- **Classical.** Bach, Beethoven and the like → Western Classical. Bartók, Schnittke and other 20th-century composers → Modern Classical. Pärt, Górecki and Hillier → Holy Minimalism. Reich, Glass and Riley → Minimalism. Basinski and Laurie Anderson → Post-Minimalism.
- **Lee Hazlewood** → Countrypolitan, plus Baroque Pop where it fits.
- **Slowcore vs. Sadcore.** Use Slowcore for the tempo and texture (Low, Galaxie 500, Codeine). Use Sadcore for the songwriting-led misery (Red House Painters, American Music Club, Mazzy Star). Using both is fine.

## MusicBrainz → vocabulary mapping
This table covers every MusicBrainz genre that appears in at least 10 library records. A few frequent sub-10 tags are listed after it.

| MusicBrainz genre (records) | Vocabulary |
|---|---|
| rock (1837) | (parent Rock; pick a specific genre per record) |
| indie rock (749) | Indie Rock |
| electronic (559) | (parent Electronic; pick a specific genre per record) |
| pop (511) | (parent Pop; pick a specific genre per record) |
| alternative rock (469) | Alternative Rock |
| folk rock (296) | Folk Rock |
| experimental (266) | (parent Experimental & Ambient; pick a specific genre per record) |
| pop rock (252) | Pop Rock |
| jazz (243) | (parent Jazz; pick a specific genre per record) |
| post-punk (237) | Post-Punk |
| indie pop (192) | Indie Pop |
| new wave (191) | New Wave |
| psychedelic rock (185) | Psychedelic Rock |
| art rock (168) | Art Rock |
| folk (149) | (parent Folk, Country & Blues) → Contemporary Folk / American Folk Music / Singer-Songwriter |
| punk (148) | Punk Rock (or another Punk & Post-Punk genre) |
| hip hop (137) | (parent Hip Hop; pick a specific genre per record) |
| synth-pop (123) | Synthpop |
| classic rock (114) | (folded: pick a specific Rock genre such as Hard Rock, Blues Rock, Pop Rock or Art Rock) |
| singer-songwriter (113) | Singer-Songwriter |
| dream pop (113) | Dream Pop |
| ambient (112) | Ambient |
| country rock (109) | Country Rock |
| blues rock (108) | Blues Rock |
| shoegaze (106) | Shoegaze |
| post-rock (104) | Post-Rock |
| psychedelic (103) | Psychedelic Rock (or Psychedelic Pop / Psychedelic Folk / Psychedelic Soul) |
| hard rock (102) | Hard Rock |
| experimental rock (101) | Experimental Rock |
| lo-fi (99) | Lo-Fi Indie |
| neo-psychedelia (92) | Neo-Psychedelia |
| art pop (90) | Art Pop |
| blues (89) | (parent Folk, Country & Blues) → Country Blues / Chicago Blues / Electric Blues; Blues Rock for rock records |
| avant-garde (85) | (folded: Experimental Rock, Avant-Garde Jazz, Modern Classical or another Experimental & Ambient genre) |
| soul (84) | Soul (or a more specific Soul, R&B & Funk genre) |
| downtempo (81) | Downtempo |
| garage rock (79) | Garage Rock |
| country (78) | (parent Folk, Country & Blues) → Traditional Country / Outlaw Country / Alt-Country / Countrypolitan |
| latin (74) | (parent Latin & Caribbean, or Brazilian for Brazilian records; pick a specific genre) |
| power pop (68) | Power Pop |
| funk (68) | Funk |
| jangle pop (67) | Jangle Pop |
| psychedelic pop (62) | Psychedelic Pop |
| indie folk (62) | Indie Folk |
| punk rock (60) | Punk Rock |
| chamber pop (58) | Chamber Pop |
| noise pop (58) | Noise Pop |
| rock and roll (57) | Rock & Roll |
| leftfield (56) | (descriptor; ignore) |
| noise rock (55) | Noise Rock |
| r&b (55) | Rhythm & Blues (pre-1970) / Contemporary R&B (modern) |
| progressive (54) | (descriptor) → Progressive Rock if it is prog |
| baroque pop (48) | Baroque Pop |
| mpb (47) | MPB |
| progressive rock (45) | Progressive Rock |
| instrumental (45) | (descriptor; ignore) |
| gothic rock (44) | Gothic Rock |
| post-hardcore (42) | Post-Hardcore |
| hard bop (42) | Hard Bop |
| americana (41) | Americana |
| ambient pop (41) | Ambient Pop |
| house (41) | House |
| idm (40) | IDM |
| electro (40) | Electro (MusicBrainz overuses it; prefer Synthpop / Alternative Dance / House when that fits better) |
| contemporary r&b (40) | Contemporary R&B |
| contemporary folk (39) | Contemporary Folk |
| east coast hip hop (39) | East Coast Hip Hop |
| hardcore hip hop (39) | Hardcore Hip Hop |
| soft rock (37) | Soft Rock |
| disco (36) | Disco |
| krautrock (36) | Krautrock |
| trip hop (35) | Trip Hop |
| space rock (32) | Space Rock |
| glam rock (31) | Glam Rock |
| conscious hip hop (31) | Conscious Hip Hop |
| electronica (30) | (folded) → Downtempo / IDM / Indietronica |
| electropop (29) | Electropop |
| avant-garde jazz (29) | Avant-Garde Jazz |
| post-bop (28) | Post-Bop |
| psychedelic folk (27) | Psychedelic Folk |
| indietronica (27) | Indietronica |
| proto-punk (27) | Proto-Punk |
| art punk (27) | Art Punk |
| alternative country (26) | Alt-Country |
| alternative dance (25) | Alternative Dance |
| dance-pop (25) | Dance-Pop |
| slowcore (24) | Slowcore (and/or Sadcore) |
| folk pop (24) | Folk Pop |
| experimental hip hop (24) | Experimental Hip Hop |
| reggae (24) | Roots Reggae (or Ska / Dub) |
| industrial (24) | Industrial |
| boom bap (24) | Boom Bap |
| neo soul (24) | Neo-Soul |
| britpop (23) | Britpop |
| heavy metal (23) | Heavy Metal |
| slacker rock (23) | Slacker Rock |
| ballad (23) | (descriptor; ignore) |
| drone (23) | Drone |
| techno (23) | Techno |
| jazz rap (23) | Jazz Rap |
| bossa nova (23) | Bossa Nova |
| alternative r&b (23) | Alternative R&B |
| ethereal wave (22) | Ethereal Wave |
| noise (22) | Noise |
| cool jazz (22) | Cool Jazz |
| free jazz (22) | Free Jazz |
| alternative pop (21) | (folded) → Indie Pop / Art Pop |
| jazz rock (21) | Jazz Fusion |
| classical (21) | (parent Classical & Soundtrack) → Western Classical / Modern Classical / Minimalism |
| hardcore punk (21) | Hardcore Punk |
| gangsta rap (21) | Gangsta Rap |
| progressive pop (20) | (folded) → Art Pop / Psychedelic Pop / Baroque Pop |
| no wave (19) | No Wave |
| roots rock (19) | Roots Rock |
| afrobeat (19) | Afrobeat (but Vampire Weekend, Graceland and Sault are not Afrobeat records; use their main genres) |
| post-punk revival (19) | Post-Punk Revival |
| pop rap (19) | Pop Rap |
| dance (18) | (descriptor) → House / Dance-Pop / Alternative Dance |
| chamber folk (18) | Chamber Folk |
| dub (18) | Dub |
| acid rock (17) | Psychedelic Rock / Heavy Psych |
| piano rock (17) | (descriptor) → Pop Rock / Soft Rock / Singer-Songwriter |
| twee pop (16) | Twee Pop |
| psychedelic soul (16) | Psychedelic Soul |
| space rock revival (15) | Space Rock Revival |
| grunge (15) | Grunge |
| mod (15) | Beat Music / British Rhythm & Blues / Freakbeat |
| synth funk (15) | Synth Funk |
| modal jazz (15) | Modal Jazz |
| punk blues (14) | Punk Blues |
| metal (14) | Heavy Metal (or Stoner Rock) |
| sophisti-pop (14) | Sophisti-Pop |
| jazz fusion (14) | Jazz Fusion |
| arena rock (13) | Hard Rock / Pop Rock |
| alternative punk (13) | Punk Rock / Pop Punk |
| west coast hip hop (13) | West Coast Hip Hop |
| jazz-funk (13) | Jazz-Funk |
| samba (13) | Samba |
| southern rock (12) | Southern Rock |
| deep house (12) | Deep House |
| garage rock revival (12) | Garage Rock Revival |
| gospel (12) | Gospel |
| tech house (12) | House / Microhouse |
| political hip hop (12) | Conscious Hip Hop |
| dance-rock (11) | Dance-Punk / New Wave |
| funk rock (11) | Funk |
| garage punk (11) | Garage Punk |
| symphonic rock (11) | Progressive Rock |
| vocal jazz (11) | Vocal Jazz |
| pop punk (11) | Pop Punk |
| dance-punk (11) | Dance-Punk |
| post-industrial (11) | Industrial |
| instrumental hip hop (11) | Instrumental Hip Hop |
| smooth soul (11) | Smooth Soul |
| contemporary jazz (11) | (folded) → Post-Bop / Spiritual Jazz / Jazz Fusion |
| abstract hip hop (11) | Abstract Hip Hop |
| alternative hip hop (11) | Abstract Hip Hop / Conscious Hip Hop |
| comedy (11) | Stand-Up Comedy (or Comedy Rock for music) |
| rock opera (10) | (descriptor) → Art Rock / Progressive Rock / Hard Rock |
| blue-eyed soul (10) | Blue-Eyed Soul |
| plunderphonics (10) | Plunderphonics |
| progressive electronic (10) | Progressive Electronic |
| southern soul (10) | Southern Soul |
| glitch pop (10) | Glitch / Art Pop |
| pop soul (10) | Pop Soul |
| glitch (10) | Glitch |
| spiritual jazz (10) | Spiritual Jazz |

### Notable sub-10 tags
| MusicBrainz genre | Vocabulary |
|---|---|
| tropicália (7) | Tropicália |
| samba-jazz (3), samba soul | Samba-Jazz, Samba Soul |
| soul jazz (8) | Soul Jazz |
| third stream (7) | Third Stream |
| big band (6), swing (4) | Big Band |
| bebop (4) | Bebop |
| latin jazz (6), afro-cuban jazz | Latin Jazz |
| ethio-jazz | Ethio-Jazz |
| afro-funk, afro rock | Afro-Funk |
| desert blues | Desert Blues |
| roots reggae (7), rocksteady (3) | Roots Reggae |
| ska (6), 2 tone | Ska |
| cumbia (4) | Cumbia |
| bolero (4) | Bolero |
| salsa, son cubano, mambo | Salsa |
| latin pop (4), reggaeton (3), flamenco pop | Latin Pop |
| latin rock | Latin Rock |
| emo (8) | Emo |
| math rock (6), math pop (3) | Math Rock |
| c86 (5) | C86 |
| chillwave (8) | Chillwave |
| hypnagogic pop | Hypnagogic Pop |
| bedroom pop (3) | Bedroom Pop |
| sunshine pop (9) | Sunshine Pop |
| lounge (9), exotica, space age pop (4) | Lounge |
| easy listening (7) | Easy Listening |
| traditional pop (4), brill building (3) | Traditional Pop |
| yé-yé | Yé-yé |
| chanson française | Chanson |
| c-pop, cantopop, mandopop | Mandopop |
| j-pop | (folded) → Dream Pop / Shibuya-kei / Synthpop as fits |
| anatolian rock | Anatolian Rock |
| heavy psych (5), garage psych (4) | Heavy Psych |
| stoner rock (8), stoner metal (6), doom metal (6), sludge metal (4) | Stoner Rock / Heavy Metal |
| post-metal (7) | Post-Rock / Heavy Metal |
| trance (9), progressive house (6), electro house (5) | House / Techno |
| microhouse (6), minimal techno (4) | Microhouse |
| ambient techno (6) | Ambient Techno |
| big beat (3), breaks (3) | Big Beat |
| drum and bass (4), jungle (4) | Drum and Bass |
| uk garage (4), future garage (3), dubstep | UK Bass |
| electroclash (5), new rave (5) | Electro / Alternative Dance |
| folktronica (9) | Folktronica |
| berlin school (5) | Progressive Electronic |
| trap (9) | Trap |
| southern hip hop (5) | Southern Hip Hop |
| mafioso rap (7), coke rap (3) | East Coast Hip Hop / Gangsta Rap |
| industrial hip hop (4) | Experimental Hip Hop |
| turntablism (5) | Instrumental Hip Hop |
| underground hip hop (4) | Abstract Hip Hop / Boom Bap |
| deep soul (6) | Deep Soul |
| chicago soul (4), motown (3) | Chicago Soul / Pop Soul |
| p-funk (4), g-funk (4) | P-Funk (G-funk → West Coast Hip Hop) |
| boogie (4), quiet storm (3) | Synth Funk / Smooth Soul |
| coldwave (6), dark wave (6) | Coldwave / Darkwave |
| neoclassical dark wave (4) | Darkwave / Ethereal Wave |
| gothic (6) | Gothic Rock |
| anarcho-punk (3), celtic punk (3), folk punk (9) | Punk Rock |
| beat music (6), merseybeat (5) | Beat Music |
| british rhythm & blues (5), british blues (4) | British Rhythm & Blues |
| rockabilly (7), psychobilly (3) | Rockabilly |
| surf rock (4), surf (4), surf punk (3) | Surf Rock |
| glam (9) | Glam Rock |
| heartland rock (6) | Heartland Rock |
| pub rock (3) | Roots Rock / Power Pop |
| british folk rock (7), progressive folk (6), celtic rock (4) | British Folk Rock |
| freak folk (5), free folk (4), avant-folk (9), anti-folk (3) | Freak Folk |
| neofolk (5) | Psychedelic Folk / Chamber Folk |
| outlaw country (4) | Outlaw Country |
| traditional country (6), country gospel (4) | Traditional Country |
| progressive country (8), country pop (4) | Countrypolitan / Alt-Country |
| gothic country (5) | Gothic Country |
| bluegrass (7) | Bluegrass |
| country blues (7), delta blues (3), acoustic blues (3) | Country Blues |
| chicago blues (6) | Chicago Blues |
| electric blues (7) | Electric Blues |
| modern classical (9), orchestral (4) | Modern Classical |
| minimalism (4) | Minimalism |
| post-minimalism (3), tape music (6) | Post-Minimalism / Tape Music |
| dark ambient (4) | Dark Ambient |
| space ambient (3) | Ambient |
| musique concrète (5) | Musique Concrète |
| sound collage (5), sampledelia (4) | Sound Collage / Plunderphonics |
| free improvisation (7) | Free Improvisation |
| non-music (9) | (descriptor; comedy and spoken word records → Spoken Word & Comedy) |
| standup comedy (5) | Stand-Up Comedy |
| comedy rock (4) | Comedy Rock |
| spoken word (6) | Spoken Word |
| dub poetry | Dub Poetry |
| poetry (Last Poets, Gil Scott-Heron) | Jazz Poetry |
| hyperpop (4) | Electropop |
| dance-pop / club (9) | Dance-Pop |
| worldbeat (4) | (folded: tag by the record's main genre) |

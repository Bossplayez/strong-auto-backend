// Facility directory copied from the existing Strong Auto calculator. It is
// public location metadata, not a provider credential or tariff table.
export const LEGACY_CALCULATOR_PLATFORM_IDS = {"copart":["71","569","628","91","73","120","92","108","160","138","165","103","144","135","14","612","60","5","98","187","48","115","125","574","70","189","580","142","156","166","643","119","86","35","78","40","557","106","107","651","113","54","117","28","191","93","182","181","180","183","11","158","79","153","151","66","114","167","58","59","186","576","573","581","44","100","171","567","129","145","192","168","607","4","83","95","571","30","67","62","608","584","152","148","74","22","190","3","102","105","10","640","43","146","39","149","16","147","635","575","109","99","55","617","642","110","80","116","20","587","161","29","13","9","132","12","558","87","162","604","75","63","141","21","616","101","32","136","570","638","36","77","56","568","169","582","134","585","637","61","76","23","639","51","170","46","104","163","17","140","53","614","69","49","25","150","45","629","27","82","155","8","123","126","52","641","94","630","572","96","128","97","34","618","2","184","72","7","57","6","84","131","121","81","130","15","88","26","164","652","133","111","89","50","653","19","157","24","112","33","64","85","586","124","90","18","1","42","159","127","31","619","620","68","137","143","65","615","118"],"iaai":["378","379","380","561","382","383","384","385","386","387","388","562","390","391","392","393","394","395","396","654","631","397","632","398","399","400","401","402","403","404","405","588","406","407","408","409","589","410","655","411","412","413","414","415","416","417","418","419","420","421","577","422","423","424","425","426","427","428","429","430","431","432","433","434","435","436","438","439","590","440","606","563","442","443","444","445","446","447","448","449","621","450","452","453","454","455","456","457","458","591","592","459","461","622","462","463","464","465","466","467","609","468","469","470","578","471","472","473","636","475","476","477","593","478","479","480","564","481","482","483","484","485","594","486","487","488","489","490","491","492","649","493","595","648","596","494","495","496","497","498","499","500","501","502","644","503","504","597","505","506","507","508","509","510","511","611","512","513","514","623","515","516","634","517","598","518","520","522","646","565","524","625","525","650","526","527","528","610","529","579","530","531","532","533","534","535","536","566","538","539","645","599","540","647","633","600","541","542","543","544","545","546","547","548","601","549","550","602","605","552","553","554","603","555"]} as const;

export type LegacyCalculatorProvider = keyof typeof LEGACY_CALCULATOR_PLATFORM_IDS;

/**
 * Public IAAI location directory from the already-used Strong Auto calculator.
 * It is only an identifier-to-location index: no tariffs, credentials, or
 * delivery figures are copied here. A lookup needs the full provider location
 * plus state; a city name alone is never enough.
 */
const IAAI_LOCATION_DIRECTORY = `378:Abilene (TX)|379:ACE - Carson (CA)|380:ACE - Perris (CA)|561:ACE - Perris 2 (CA)|382:ADESA Birmingham (AL)|383:Akron-Canton (OH)|384:Albany (NY)|385:Albuquerque (NM)|386:Altoona (PA)|387:Amarillo (TX)|388:Anaheim (CA)|562:Anchorage (AK)|390:Appleton (WI)|391:Asheville (NC)|392:Ashland (KY)|393:Atlanta (GA)|394:Atlanta East (GA)|395:Atlanta North (GA)|396:Atlanta South (GA)|654:Atlanta West (GA)|631:AUSTIN (TX)|397:Austin (TX)|632:AUSTIN North (TX)|398:Avenel New Jersey (NJ)|399:Baltimore (MD)|400:Baton Rouge (LA)|401:Billings (MT)|402:Birmingham (AL)|403:Boise (ID)|404:Boston - Shirley (MA)|405:Bowling Green (KY)|588:Brandon (MB)|406:Bridgeport (PA)|407:Buckhannon (WV)|408:Buffalo (NY)|409:Burlington (VT)|589:Calgary South (AB)|410:Casper (WY)|655:Central New Jersey (NJ)|411:Central New Jersey (NJ)|412:Charleston (SC)|413:Charlotte (NC)|414:Chattanooga (TN)|415:Chicago-North (IL)|416:Chicago-South (IL)|417:Chicago-West (IL)|418:Cincinnati (OH)|419:Cincinnati-South (OH)|420:Clearwater (FL)|421:Cleveland (OH)|577:Colorado Springs (CO)|422:Colton (CA)|423:Columbia (SC)|424:Columbus (OH)|425:Concord (NC)|426:Corpus Christi (TX)|427:Culpeper (VA)|428:Dallas (TX)|429:Dallas/Ft Worth (TX)|430:Davenport (IA)|431:Dayton (OH)|432:Denver (CO)|433:Denver East (CO)|434:Des Moines (IA)|435:Detroit (MI)|436:Dothan (AL)|438:Dundalk (MD)|439:East Bay (CA)|590:Edmonton (AB)|440:El Paso (TX)|606:Elkton (MD)|563:Englishtown (NJ)|442:Erie (PA)|443:Eugene (OR)|444:Fargo (ND)|445:Fayetteville (AR)|446:Flint (MI)|447:Fontana (CA)|448:Fort Myers (FL)|449:Fort Pierce (FL)|621:Fort Wayne (IN)|450:Fort Worth North (TX)|452:Fremont (CA)|453:Fresno (CA)|454:Grand Rapids (MI)|455:Greensboro (NC)|456:Greenville (SC)|457:Grenada (MS)|458:Gulf Coast (MS)|591:Halifax (NS)|592:Hamilton (ON)|459:Hartford (CT)|461:High Desert (CA)|622:High Point (NC)|462:Honolulu (HI)|463:Houston (TX)|464:Houston South (TX)|465:Houston-North (TX)|466:Huntsville (AL)|467:Indianapolis (IN)|609:Indianapolis South (IN)|468:Jackson (MS)|469:Jacksonville (FL)|470:Kansas City (KS)|578:Kansas City East (MO)|471:Knoxville (TN)|472:Lafayette (LA)|473:Las Vegas (NV)|636:LEE'S TOWING KAUAI (HI)|475:Lexington (SC)|476:Lincoln (IL)|477:Little Rock (AR)|593:London (ON)|478:Long Island (NY)|479:Longview (TX)|480:Los Angeles (CA)|564:Los Angeles South (CA)|481:Louisville (KY)|482:Louisville North (KY)|483:Lubbock (TX)|484:Macon (GA)|485:Manchester (NH)|594:Manitoba (MB)|486:McAllen (TX)|487:Memphis (TN)|488:Metro DC (MD)|489:Miami (FL)|490:Miami-North (FL)|491:Milwaukee (WI)|492:MINNEAPOLIS SOUTH (MN)|649:Minneapolis/St. Paul (MN)|493:Missoula (MT)|595:Moncton (NB)|648:Monticello (NY)|596:Montreal (QC)|494:Nashville (TN)|495:New Castle (DE)|496:New Orleans (LA)|497:New Orleans East (LA)|498:Newburgh (NY)|499:North Hollywood (CA)|500:Northern Virginia (VA)|501:Oklahoma City (OK)|502:Omaha (NE)|644:OMAHA SOUTH (NE)|503:Orlando (FL)|504:Orlando-North (FL)|597:Ottawa (ON)|505:Paducah (KY)|506:Pensacola (FL)|507:Permian Basin (TX)|508:Philadelphia (PA)|509:Phoenix (AZ)|510:Pittsburgh (PA)|511:Pittsburgh-North (PA)|611:Port Murray (NJ)|512:Portage (WI)|513:Portland (OR)|514:Portland - Gorham (ME)|623:Portland South (OR)|515:Portland West (OR)|516:Providence (RI)|634:Provo (UT)|517:Pulaski (VA)|598:Quebec City (QC)|518:Raleigh (NC)|520:Reno (NV)|522:Richmond (VA)|646:RIVERSIDE (CA)|565:Roanoke (VA)|524:Rochester (NY)|625:Rosedale (MD)|525:Sacramento (CA)|650:SACRAMENTO WEST (CA)|526:Salt Lake City (UT)|527:San Antonio-South (TX)|528:San Diego (CA)|610:Santa Clarita (CA)|529:Savannah (GA)|579:Sayreville (NJ)|530:Scranton (PA)|531:Seattle (WA)|532:Shady Spring (WV)|533:Shreveport (LA)|534:Sioux Falls (SD)|535:South Bend (IN)|536:Southern New Jersey (NJ)|566:Specialty Division (IL)|538:Spokane (WA)|539:Springfield (MO)|645:ST. CLOUD (MN)|599:St. John's (NL)|540:St. Louis (IL)|647:STATEN ISLAND (NY)|633:STOCKTON (CA)|600:Sudbury (ON)|541:Suffolk (VA)|542:Syracuse (NY)|543:Tampa (FL)|544:Tampa North (FL)|545:Taunton (MA)|546:Templeton (MA)|547:Tidewater (VA)|548:Tifton (GA)|601:Toronto (ON)|549:Tucson (AZ)|550:Tulsa (OK)|602:Vancouver (BC)|605:West Palm Beach (FL)|552:Western Colorado (CO)|553:Wichita (KS)|554:Winnipeg (MB)|603:Winnipeg (MB)|555:York Springs (PA)`;

const IAAI_LOCATION_TO_PLATFORM = new Map<string, string[]>();
for (const entry of IAAI_LOCATION_DIRECTORY.split('|')) {
  const separator = entry.indexOf(':');
  const id = entry.slice(0, separator);
  const key = normalizeLocationKey(entry.slice(separator + 1));
  if (!key) continue;
  const ids = IAAI_LOCATION_TO_PLATFORM.get(key) ?? [];
  ids.push(id);
  IAAI_LOCATION_TO_PLATFORM.set(key, ids);
}

export function isLegacyCalculatorPlatform(
  provider: LegacyCalculatorProvider,
  facilityId: string,
): boolean {
  return (LEGACY_CALCULATOR_PLATFORM_IDS[provider] as readonly string[]).includes(facilityId);
}

export interface LegacyCalculatorLocation {
  facilityId: string | null | undefined;
  locationDisplay: string | null | undefined;
  locationState: string | null | undefined;
  facilityOfficeName: string | null | undefined;
  facilityState: string | null | undefined;
}

export function resolveLegacyCalculatorPlatform(
  provider: LegacyCalculatorProvider,
  location: LegacyCalculatorLocation,
): string | null {
  const facilityId = location.facilityId?.trim();
  if (facilityId && isLegacyCalculatorPlatform(provider, facilityId)) return facilityId;

  if (provider !== 'iaai') return null;

  const keys = new Set([
    normalizeLocationKey(location.locationDisplay),
    normalizeLocationKey(withExplicitState(location.locationDisplay, location.locationState)),
    normalizeLocationKey(withExplicitState(location.facilityOfficeName, location.facilityState)),
  ]);
  for (const key of keys) {
    if (!key) continue;
    const matches = IAAI_LOCATION_TO_PLATFORM.get(key);
    if (matches?.length === 1) return matches[0];
  }
  return null;
}

function withExplicitState(name: string | null | undefined, state: string | null | undefined): string | null {
  const cleanName = name?.trim();
  const cleanState = state?.trim().toUpperCase();
  return cleanName && /^[A-Z]{2}$/.test(cleanState ?? '') ? `${cleanName} (${cleanState})` : null;
}

function normalizeLocationKey(value: string | null | undefined): string | null {
  if (!value) return null;
  const match = value.trim().replace(/\s+/g, ' ').match(/^(.+?)\s*\(([A-Za-z]{2})\)$/);
  if (!match) return null;
  return `${match[1].trim().replace(/\s*-\s*/g, '-').toUpperCase()} (${match[2].toUpperCase()})`;
}

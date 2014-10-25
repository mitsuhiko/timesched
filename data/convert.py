import os
import re
import math
import json
from itertools import chain
from xml.etree import cElementTree as et


os.chdir(os.path.abspath(os.path.dirname(__file__)))


def convert_countries():
    countries = {}

    with open('raw/countryInfo.txt', 'rb') as f:
        for line in f:
            line = line.decode('utf-8').strip().split('\t')
            if not line or line[0][:1] == '#':
                continue

            country_code = line[0]
            country = line[4]
            capital = line[5]
            countries[country_code] = {
                'name': country,
                'capital': capital,
                'code': country_code
            }

    return countries


def convert_cities():
    cities = {}

    with open('raw/cities15000.txt', 'rb') as f:
        for line in f:
            line = line.decode('utf-8').strip().split('\t')
            if not line:
                continue

            main_name = line[2]
            country = line[8]
            state = country == 'US' and line[10] or None
            population = int(line[14])
            timezone = line[17]
            is_capital = line[7] == 'PPLC'

            city_key = ('%s/%s%s' % (country, main_name,
                state and '/' + state or '')).replace(' ', '_')
            old_city = cities.get(city_key)

            # There was already a city with that name, let the one
            # with the higher population win.
            if old_city is not None:
                if population < old_city['population']:
                    continue

            cities[city_key] = {
                'country': country,
                'state': state,
                'name': main_name,
                'timezone': timezone,
                'population': population,
                'is_capital': is_capital,
            }

    return cities


def find_windows_zones():
    tree = et.parse('windows_zones.xml')
    rv = {}
    for map_zone in tree.findall(
            './/windowsZones/mapTimezones/mapZone'):
        if map_zone.attrib.get('territory') == '001':
            rv[map_zone.attrib['other']] = map_zone.attrib['type'].split(None)[0]
    return rv


def find_weekend_info():
    day_to_int = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'].index
    tree = et.parse('supplemental_data.xml')
    rv = {'start': {}, 'end': {}}
    for info in tree.findall('.//weekendStart'):
        for t in info.attrib['territories'].split():
            rv['start'][t] = day_to_int(info.attrib['day'])
    for info in tree.findall('.//weekendEnd'):
        for t in info.attrib['territories'].split():
            rv['end'][t] = day_to_int(info.attrib['day'])
    return rv


def combine_data(countries, cities, timezone_data, windows_zones, weekends):
    selectables = []
    timezones_found = set()

    timezone_mapping = {}
    for tzinfo in timezone_data['zones']:
        tz = tzinfo.split('|')[0]
        if tz not in timezone_mapping:
            timezone_mapping[tz] = len(timezone_mapping)
    for tzlink in timezone_data['links']:
        target, tz = tzlink.split('|')
        timezone_mapping[tz] = timezone_mapping[target]
    reverse_timezone_mapping = dict((v, k) for k, v in
                                    timezone_mapping.iteritems())

    def get_tz_tokens(tz):
        # super shitty way to guess the timezone abbreviations.  Totally
        # does not work for many of them.
        rv = ''
        if tz in timezone_data['links']:
            tz = timezone_data['links'][tz]

        zone = timezone_data['zones'][timezone_mapping[tz]].split('|')
        for abbr in zone[1].split(None):
            rv += ' ' + abbr

        rv = rv.replace('/', ' ')

        # reject obvious wrong ones.  obviously the above code can
        # generate invalid abbreviations.
        return [x for x in set(rv.lower().split()) if len(x) > 2]

    def record_selectable(key, name, full_name, tz,
                          country=None, common_tz=False, sortinfo=None):
        tokens = set(re.sub('[^\s\w]', '', full_name.lower()).split())
        tokens.update(get_tz_tokens(tz))

        rv = {
            'k': key,
            'd': full_name,
            'z': timezone_mapping[tz],
            'T': ' '.join(sorted(tokens)),
            'sortinfo': sortinfo or {},
        }
        if name != full_name:
            rv['n'] = name
        if country is not None:
            rv['c'] = country
        if common_tz:
            rv['C'] = 1
        selectables.append(rv)

    for city in cities.itervalues():
        key = \
            city['country'].lower() + ':' + \
            (city['name'] + ':' + (city['state'] or '')).rstrip(':').lower() \
                .replace(' ', '-') \
                .replace('_', '-') \
                .replace('\'', '') \
                .replace(',', '') \
                .replace('(', '') \
                .replace(')', '')
        display_parts = [countries[city['country']]['name']]
        if city['state']:
            display_parts.append(city['state'])
        display_parts.append(city['name'])
        record_selectable(key, city['name'], ', '.join(display_parts),
                          city['timezone'], city['country'],
                          sortinfo={'city': city})
        timezones_found.add(city['timezone'])

    for name in timezone_mapping:
        if name in timezones_found or \
           not (name.lower().startswith('etc/') or not '/' in name):
            continue
        key = name.lower() \
            .replace('_', '-') \
            .replace('/', ':') \
            .replace(',', '') \
            .replace('\'', '')
        record_selectable(key, name.split('/', 1)[-1], name, name)

    for name, tzname in windows_zones.iteritems():
        key = '-'.join(name.lower().split(None)) \
            .replace('(', '') \
            .replace(')', '') \
            .replace(',', '')
        record_selectable(key, name, name, tzname, common_tz=True)

    def _sort_key(x):
        words = x['d'].split()
        if len(words) == 1:
            canonical_abbr = words[0].lower()
        else:
            canonical_abbr = ''.join(x[:1] for x in words).lower()
        canonical = canonical_abbr in x['T'].split()

        city = x['sortinfo'].get('city')
        name = x['d'].lower()
        importance = 0
        if x.get('C'):
            importance += 5
        if city:
            if city['is_capital']:
                importance += 1
            importance += math.log(max(city['population'], 1)) / 50.0
        return not canonical, -importance, name
    selectables.sort(key=_sort_key)
    for selectable in selectables:
        selectable.pop('sortinfo', None)

    return {
        'tzmap': reverse_timezone_mapping,
        'timezones': timezone_data['zones'],
        'timezone_links': timezone_data['links'],
        'selectables': selectables,
        'weekends': weekends,
        'countries': dict((k, v['name']) for k, v in countries.iteritems()),
    }


def write_combined_data(data, f):
    f.write('moment.tz.add(%s);\n' %
            json.dumps(data['timezones']))
    f.write('moment.tz.link(%s);\n' %
            json.dumps(data['timezone_links']))
    f.write('timesched.setTimezoneData(%s);\n' % json.dumps({
        'tzmap': data['tzmap'],
        'selectables': data['selectables'],
        'weekends': data['weekends'],
    }))


def main():
    countries = convert_countries()
    cities = convert_cities()
    windows_zones = find_windows_zones()
    weekends = find_weekend_info()
    with open('timezones.json') as f:
        timezones = json.load(f)
    combined = combine_data(countries, cities, timezones, windows_zones,
                            weekends)
    with open('../lib/generated/data.js', 'w') as f:
        write_combined_data(combined, f)


if __name__ == '__main__':
    main()

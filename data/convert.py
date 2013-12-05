import os
import math
import json
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


def combine_data(countries, cities, timezone_data, windows_zones):
    selectables = []
    timezones_found = set()

    def record_selectable(key, name, full_name, type, tz, sortinfo=None):
        selectables.append({
            'k': key,
            'n': name,
            'd': full_name,
            'z': tz,
            't': type,
            'sortinfo': sortinfo or {},
        })

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
                          'C', city['timezone'], sortinfo={'city': city})
        timezones_found.add(city['timezone'])

    for name in timezone_data['meta']:
        if name in timezones_found or \
           not (name.lower().startswith('etc/') or not '/' in name):
            continue
        key = name.lower() \
            .replace('_', '-') \
            .replace('/', ':') \
            .replace(',', '') \
            .replace('\'', '')
        record_selectable(key, name.split('/', 1)[-1], name, 'T', name)

    for name, tzname in windows_zones.iteritems():
        key = '-'.join(name.lower().split(None)) \
            .replace('(', '') \
            .replace(')', '') \
            .replace(',', '')
        record_selectable(key, name, name, 'T', tzname, {
            'common_tz': True
        })

    def _sort_key(x):
        city = x['sortinfo'].get('city')
        name = x['n'].lower()
        importance = 0
        if x['sortinfo'].get('common_tz'):
            importance += 5
        if city:
            if city['is_capital']:
                importance += 1
            importance += math.log(max(city['population'], 1)) / 50.0
        return -importance, name
    selectables.sort(key=_sort_key)
    for selectable in selectables:
        selectable.pop('sortinfo', None)

    return {
        'timezones': timezone_data,
        'selectables': selectables,
        'countries': dict((k, v['name']) for k, v in countries.iteritems()),
    }


def write_combined_data(data, f):
    f.write('moment.tz.add(%s);\n' %
            json.dumps(data['timezones']))
    f.write('timesched.setTimezoneData(%s);\n' % json.dumps({
        'selectables': data['selectables'],
        'countries': data['countries'],
    }))


def main():
    countries = convert_countries()
    cities = convert_cities()
    windows_zones = find_windows_zones()
    with open('timezones.json') as f:
        timezones = json.load(f)
    combined = combine_data(countries, cities, timezones, windows_zones)
    with open('../lib/generated/data.js', 'w') as f:
        write_combined_data(combined, f)


if __name__ == '__main__':
    main()

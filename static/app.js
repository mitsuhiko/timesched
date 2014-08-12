'use strict';

/* global moment */

var timesched = angular
  .module('timesched', ['ui.bootstrap', 'ui.sortable', 'ui.slider'])
  .config(function($locationProvider) {
    $locationProvider.html5Mode(true);
  });

(function() {
  var BITLY_USERNAME = 'timesched';
  var BITLY_API_KEY = 'R_3f0f8f820913780173ac3fc19845d0b5';
  var TWEET_PREFIX = 'Let\'s meet at ';
  var MAIL_SUBJECT = 'Scheduled Meeting';
  var MAIL_HEADER = '\n\n';
  var MAIL_FOOTER = '\n\nView this time table online: $url';
  var SELECTABLES = [];
  var WEEKEND_INFO = {};
  var SELECTABLES_BY_NAME = {};
  var SELECTABLES_BY_KEY = {};
  var COMMON_ZONES = [];

  function normalizeZoneName(zoneName) {
    return zoneName.toLowerCase().replace(/^\s+|\s+$/g, '');
  }

  function zoneExists(input) {
    return !!SELECTABLES_BY_NAME[normalizeZoneName(input)];
  }

  function lookupTimeZoneState(input) {
    var zone = SELECTABLES_BY_NAME[normalizeZoneName(input)];
    if (!zone) {
      zone = SELECTABLES_BY_KEY[input];
      if (!zone)
        return null;
    }
    var m;
    try {
      m = moment().tz(normalizeZoneName(zone.z));
    } catch (e) {
    }
    return m !== null ? new TimeZoneState(m, zone) : null;
  }

  function shortenURL(url, func) {
    $.getJSON('https://api-ssl.bitly.com/v3/shorten?callback=?', {
      format: 'json',
      apiKey: BITLY_API_KEY,
      login: BITLY_USERNAME,
      longUrl: url
    }, function(response) {
      func(response.data.url);
    });
  }

  function loadFromStorage(key, def) {
    var rv = window.localStorage.getItem('timesched-' + key);
    return rv !== null ? JSON.parse(rv) : (def !== undefined ? def : null);
  }

  function putInStorage(key, value) {
    window.localStorage.setItem('timesched-' + key, JSON.stringify(value));
  }

  function getLocalTimeZoneState() {
    var now = Date.now();
    function makeKey(id) {
      return [0, 4, 8, -5 * 12, 4 - 5 * 12, 8 - 5 * 12].map(function(months) {
        var m = moment(now + months * 30 * 24 * 60 * 60 * 1000);
        if (id)
          m.tz(id);
        return m.format('DDHH');
      }).join(' ');
    }

    var thisKey = makeKey();

    for (var i = 0; i < COMMON_ZONES.length; i++) {
      var sel = COMMON_ZONES[i];
      if (thisKey === makeKey(sel.z))
        return lookupTimeZoneState(sel.k);
    }

    return null;
  }

  timesched.setTimezoneData = function(data) {
    SELECTABLES = [];
    WEEKEND_INFO = {};
    SELECTABLES_BY_NAME = {};
    SELECTABLES_BY_KEY = {};

    for (var i = 0; i < data.selectables.length; i++) {
      var sel = data.selectables[i];
      sel.z = data.tzmap[sel.z];
      sel.value = sel.d;
      sel.tokens = sel.T.split(/ /);
      delete sel.T;
      delete sel.d;
      SELECTABLES.push(sel);
      SELECTABLES_BY_NAME[sel.value.toLowerCase()] = sel;
      SELECTABLES_BY_KEY[sel.k] = sel;
      if (sel.C)
        COMMON_ZONES.push(sel);
    }
    WEEKEND_INFO = data.weekends;
  };

  function getWeekendInfo(country) {
    var start = WEEKEND_INFO.start[country] || WEEKEND_INFO.start['001'];
    var end = WEEKEND_INFO.end[country] || WEEKEND_INFO.end['001'];
    return [start, end];
  }

  function isWeekend(info, day) {
    var start = info[0];
    var end = info[1];
    if (start > end)
      return day >= start || day <= end;
    return day >= start && day <= end;
  }

  function TimeZoneState(m, zone) {
    this.tz = m.tz();
    this.urlKey = zone.k;
    this.offset = 0;
    this.timezoneShortName = zone.n || zone.value;
    this.timezoneName = zone.value;
    this.weekendInfo = getWeekendInfo(zone.c || null);

    this._cacheDay = null;
    this._cacheTZ = null;
    this.update(new Date(), null);
  }

  TimeZoneState.prototype.update = function(day, homeZone) {
    var reftz = homeZone ? homeZone.tz : this.tz;
    var start = moment.tz(moment(day).format('YYYY-MM-DDT00:00:00'), reftz);
    var ptr = start.clone().tz(this.tz);
    var offset = (start.zone() - ptr.zone()) / 60;
    var cacheDay = moment(day).format('YYYY-MM-DD');

    if (cacheDay === this._cacheDay && reftz === this._cacheTZ) {
      return;
    }

    this.dayStart = ptr.clone();
    this.homeOffset = (offset > 0 ? '+' : '') + offset;
    this.timezoneOffsetInfo = ptr.format('[UTC] Z');
    this.utcOffset = ptr.zone();
    this.timezoneAbbr = ptr.format('z');
    this.isHome = homeZone === null || homeZone.urlKey === this.urlKey;

    this.timeCells = [];
    for (var i = 0; i < 24; i++) {
      if (i !== 0)
        ptr.add('hours', 1);
      var formattedTokens = ptr.format('H|mm|LLLL (z)|ddd|DD|MMM').split(/\|/);
      this.timeCells.push({
        hour: parseInt(formattedTokens[0], 10),
        hourFormat: formattedTokens[0],
        minute: parseInt(formattedTokens[1], 10),
        minuteFormat: formattedTokens[1],
        isWeekend: isWeekend(this.weekendInfo, ptr.day()),
        tooltip: formattedTokens[2],
        weekDayFormat: formattedTokens[3],
        dayFormat: formattedTokens[4],
        monthFormat: formattedTokens[5]
      });
    }

    if (ptr.zone() !== this.utcOffset) {
      var endAbbr = ptr.format('z');
      var endOffsetInfo = ptr.format('[UTC] Z');
      if (endAbbr != this.timezoneAbbr)
        this.timezoneAbbr += '/' + endAbbr;
      if (endOffsetInfo != this.timezoneOffsetInfo)
        this.timezoneOffsetInfo += '/' + endOffsetInfo;
    }

    this._cacheDay = cacheDay;
    this._cacheTZ = reftz;
    this.updateClock();
  };

  TimeZoneState.prototype.getRangeStart = function(range) {
    return this.dayStart.clone().add('minutes', range[0]);
  };

  TimeZoneState.prototype.getRangeEnd = function(range) {
    return this.dayStart.clone().add('minutes', range[1]);
  };

  TimeZoneState.prototype.updateClock = function() {
    var now = moment().tz(this.tz);
    var oldH = this.clockHour;
    var oldM = this.clockMinute;
    var oldD = this.clockDay;
    this.clockHour = now.format('H');
    this.clockMinute = now.format('mm');
    this.clockDay = now.format('ddd, DD MMM');
    return this.clockHour !== oldH || this.clockMinute !== oldM ||
      this.clockDay != oldD;
  };

  timesched.controller('TimezoneCtrl', function($scope, $location,
                                                datepickerConfig,
                                                uiSliderConfig, $element,
                                                $timeout) {
    $scope.day = new Date();
    $scope.isToday = true;
    $scope.zones = [];
    $scope.homeZone = null;
    $scope.currentZone = null;
    $scope.ready = false;
    $scope.timeRange = [600, 1020];
    $scope.scheduleMeeting = false;
    $scope.meetingSummary = '';
    $scope.markWeekends = loadFromStorage('markWeekends', true);
    $scope.showClocks = loadFromStorage('showClocks', true);
    $scope.restoreTimezones = loadFromStorage('restoreTimezones', true);

    var localSearchChange = false;

    // make the datepicker show monday by default
    datepickerConfig.startingDay = 1;

    // customize meeting slider to be a range slider that has smaller
    // step increment when the meta key is pressed.
    uiSliderConfig.min = 0;
    uiSliderConfig.max = 1440;
    uiSliderConfig.step = 15;
    uiSliderConfig.range = true;
    uiSliderConfig.slide = function(event, ui) {
      var smallStep = event.metaKey || event.altKey || event.shiftKey;
      $(ui.handle).parent().slider({step: smallStep ? 5 : 15});
      // because we're not saving the state we manually want to update
      // the meeting summary here.
      $scope.updateMeetingSummary();
      $scope.$apply();
    };
    uiSliderConfig.stop = function() {
      $timeout(function() {
        $scope.saveState();
      }, 0);
    };

    $scope.addInputZone = function() {
      if ($scope.addZone($scope.currentZone))
        $scope.currentZone = '';
    };

    $scope.addZone = function(zoneName) {
      var zoneState = lookupTimeZoneState(zoneName);
      if (zoneState === null)
        return false;
      $scope.zones.push(zoneState);
      $scope.updateZones();
      return true;
    };

    $scope.setAsHome = function(zone) {
      $scope.homeZone = zone;
      $scope.updateZones();
      $scope.saveState();
    };

    $scope.toggleMarkWeekends = function() {
      $scope.markWeekends = !$scope.markWeekends;
    };

    $scope.toggleClocks = function() {
      $scope.showClocks = !$scope.showClocks;
      $scope.syncClockPointer();
    };

    $scope.toggleRestoreTimezones = function() {
      $scope.restoreTimezones = !$scope.restoreTimezones;
      $scope.saveState();
    };

    $scope.shortenThisURL = function(func) {
      shortenURL(window.location.href, function(url) {
        func(url);
      });
    };

    $scope.getShortURL = function() {
      $scope.forceURL();
      $scope.shortenThisURL(function(url) {
        var dialog = $('#short-url-modal');
        $('.short-url > input', dialog).val(url);
        dialog.modal({backdrop: 'static'}).modal('show');
      });
    };

    $scope.showHelp = function() {
      $('#help-modal').modal('show');
    };

    $scope.goToToday = function() {
      if ($scope.homeZone === null) {
        $scope.day = new Date();
      } else {
        $scope.day = moment(moment().tz(
          $scope.homeZone.tz).format('YYYY-MM-DD') + 'T00:00:00').toDate();
      }
      $scope.checkForToday();
    };

    $scope.goToTodayInteractive = function() {
      $timeout(function() {
        // dismiss the timezone box
        $('body').trigger('click');
        $scope.goToToday();
        $scope.$apply();
      });
    };

    $scope.removeZone = function(zone) {
      for (var i = 0, n = $scope.zones.length; i < n; i++) {
        if ($scope.zones[i] !== zone)
          continue;
        $scope.zones.splice(i, 1);
        if ($scope.homeZone === zone) {
          $scope.homeZone = null;
          $scope.updateZones();
        }
        break;
      }
    };

    $scope.sortByOffset = function() {
      $scope.sortByFunc(function(a, b) {
        return b.utcOffset - a.utcOffset;
      });
    };

    $scope.sortByName = function() {
      $scope.sortByFunc(function(a, b) {
        a = a.timezoneName.toLowerCase();
        b = b.timezoneName.toLowerCase();
        return a == b ? 0 : a < b ? -1 : 1;
      });
    };

    $scope.sortByFunc = function(sortFunc) {
      var copy = $scope.zones.slice(0);
      copy.sort(sortFunc);
      $scope.zones = copy;
    };

    $scope.reverse = function() {
      var newList = [];
      for (var i = $scope.zones.length - 1; i >= 0; i--)
        newList.push($scope.zones[i]);
      $scope.zones = newList;
    };

    $scope.clearList = function() {
      $scope.zones = [];
      $scope.homeZone = null;
      $scope.saveState(true);
    };

    $scope.updateClocks = function() {
      var rv = false;
      $scope.zones.forEach(function(zone) {
        if (zone.updateClock())
          rv = true;
      });
      var wasToday = $scope.isToday;
      $scope.checkForToday();
      return rv || (wasToday != $scope.isToday);
    };

    $scope.checkForToday = function() {
      if ($scope.homeZone === null)
        return;
      var now = moment().tz($scope.homeZone.tz).format('YYYY-MM-DD');
      var dayStart = moment($scope.day).format('YYYY-MM-DD');
      $scope.isToday = now == dayStart;
    };

    $scope.updateZones = function() {
      if (!$scope.zones.length)
        return;
      if ($scope.homeZone === null) {
        $scope.homeZone = $scope.zones[0];
        $scope.checkForToday();
      }
      $scope.zones.forEach(function(zone) {
        zone.update($scope.day, $scope.homeZone);
      });
    };

    $scope.$watch('markWeekends', function() {
      putInStorage('markWeekends', $scope.markWeekends);
    });

    $scope.$watch('showClocks', function() {
      putInStorage('showClocks', $scope.showClocks);
    });

    $scope.$watch('restoreTimezones', function() {
      putInStorage('restoreTimezones', $scope.restoreTimezones);
    });

    $scope.$watch('day', function() {
      $scope.updateZones();
      $scope.saveState();
    });

    $scope.$watch('scheduleMeeting', function() {
      $scope.syncSlider();
      $scope.saveState();
    });

    $scope.$watch('timeRange', function() {
      $scope.syncClockPointer();
      $scope.syncSlider();
      // do not save the state here because it's too slow.  Instead we
      // manually save the state when the slider gets releaesd.
    });

    $scope.$watchCollection('zones', function() {
      $scope.syncClockPointer();
      $scope.syncSlider();
      $scope.saveState();
    });

    $scope.syncClockPointer = function() {
      var ptr = $('.clock-pointer > .actual-pointer', $element);
      if ($scope.homeZone === null || !$scope.isToday || !$scope.showClocks) {
        ptr.hide();
      } else {
        ptr.css({
          height: $scope.zones.length * 50 + 'px',
          left: ((parseInt($scope.homeZone.clockHour, 10) * 60 +
                  parseInt($scope.homeZone.clockMinute, 10)) / 1440) * 100 + '%'
        }).show();
      }
    };

    $scope.syncSlider = function() {
      if (!$scope.scheduleMeeting)
        return;

      $('.ui-slider-range', $element).css({
        height: (32 + $scope.zones.length * 50) + 'px'
      });
    };

    $scope.forceURL = function() {
      // makes sure a url exists in case we were still coming from
      // the initial loading.
      $scope.saveState(!$location.search().tz);
    };

    $scope.saveState = function(doNotReplace) {
      if (!$scope.ready)
        return;
      var buf = [];
      for (var i = 0; i < $scope.zones.length; i++) {
        var zone = $scope.zones[i];
        var item = zone.urlKey;
        if (zone.isHome)
          item += '!';
        buf.push(item);
      }
      var params = {};
      params.date = moment($scope.day).format('YYYY-MM-DD');
      if (buf.length > 0)
        params.tz = buf.join(',');
      if ($scope.scheduleMeeting)
        params.range = $scope.timeRange[0] + ',' + $scope.timeRange[1];
      localSearchChange = true;
      putInStorage('lastTimezones', params.tz || '');
      $location.search(params);
      if (!doNotReplace)
        $location.replace();

      if ($scope.scheduleMeeting)
        $scope.updateMeetingSummary();
    };

    $scope.updateMeetingSummary = function() {
      $scope.meetingSummary = $scope.makeTableSummary();
    };

    $scope.makeTableSummary = function() {
      var lines = [];
      var fmt = 'HH:mm   ddd, MMM D YYYY';
      for (var i = 0; i < $scope.zones.length; i++) {
        var zone = $scope.zones[i];
        var start = zone.getRangeStart($scope.timeRange);
        var end = zone.getRangeEnd($scope.timeRange);
        if (i > 0)
          lines.push('');
        lines.push(zone.timezoneName + '  [' + start.format('z; [UTC]ZZ') +
          (start.zone() != end.zone() ? '; timezone change' : '') + ']');
        lines.push("Start: " + start.format(fmt));
        lines.push("End: " + end.format(fmt));
      }
      return lines.join('\n');
    };

    $scope.getMailBody = function(func) {
      $scope.shortenThisURL(function(url) {
        func(MAIL_HEADER + $scope.makeTableSummary() +
          MAIL_FOOTER.replace('$url', url), url);
      });
    };

    $scope.sendMeetingMail = function() {
      $scope.getMailBody(function(body) {
        location.href = 'mailto:?' +
          'subject=' + encodeURIComponent(MAIL_SUBJECT) + '&' +
          'body=' + encodeURIComponent(body);
      });
    };

    $scope.sendMeetingMailViaGMail = function() {
      $scope.getMailBody(function(body) {
        window.open('https://mail.google.com/mail/?view=cm&' +
          'to=&su=' + encodeURIComponent(MAIL_SUBJECT) + '&' +
          'body=' + encodeURIComponent(body), '_blank');
      });
    };

    $scope.tweet = function() {
      var times = [];
      for (var i = 0; i < $scope.zones.length; i++) {
        var zone = $scope.zones[i];
        var start = zone.getRangeStart($scope.timeRange);
        var end = zone.getRangeEnd($scope.timeRange);
        times.push(start.format('HH:mm') + '-' +
                   end.format('HH:mm') + ' ' + start.format('z'));
      }

      $scope.shortenThisURL(function(url) {
        window.open('https://www.twitter.com/share?' +
          'text=' + encodeURIComponent(TWEET_PREFIX + times.join(', ')) + '&' +
          'url=' + encodeURIComponent(url), '_blank');
      });
    };

    $scope.getMeetingRangeInUTC = function() {
      var dayStart = $scope.homeZone.dayStart.clone().utc();
      return [
        dayStart.clone().add('minutes', $scope.timeRange[0]),
        dayStart.clone().add('minutes', $scope.timeRange[1])
      ];
    };

    $scope.addToGoogleCalendar = function() {
      var rng = $scope.getMeetingRangeInUTC();
      function _fmt(d) {
        return d.format('YYYYMMDD[T]HHmm00[Z]');
      }
      $scope.getMailBody(function(body) {
        window.open('https://www.google.com/calendar/render?' +
          'action=TEMPLATE&' +
          'text=Meeting&' +
          'details=' + encodeURIComponent(body) + '&' +
          'output=xml&' +
          'sf=true&' +
          'trp=true&' +
          'dates=' + encodeURIComponent(_fmt(rng[0]) + '/' + _fmt(rng[1])),
            '_blank');
      });
    };

    $scope.getICalFile = function() {
      function _rc() {
        return Math.floor((1 + Math.random()) * 0x10000)
                   .toString(16).substring(1);
      }
      function _fmt(dt) {
        return dt.format('YYYYMMDD[T]HHmm00[Z]');
      }
      function _quote(text) {
        return text.replace(/\//g, '\\\\').replace(/\n/g, '\\n');
      }
      var rng = $scope.getMeetingRangeInUTC();
      var lines = [];
      lines.push('BEGIN:VCALENDAR');
      lines.push('VERSION:2.0');
      lines.push('PRODID:pocoo-timesched');
      lines.push('METHOD:PUBLISH');
      lines.push('BEGIN:VEVENT');
      lines.push('UID:' + _rc() + _rc() + _rc() + '@timesched.pocoo.org');
      lines.push('DTSTAMP:' + _fmt(moment.utc()));
      lines.push('SUMMARY:' + 'Meeting');
      lines.push('DTSTART:' + _fmt(rng[0]));
      lines.push('DTEND:' + _fmt(rng[1]));
      lines.push('DESCRIPTION:' + _quote($scope.makeTableSummary()));
      lines.push('END:VEVENT');
      lines.push('END:VCALENDAR');

      window.location.href = 'data:text/calendar;charset=utf-8,' +
        encodeURIComponent(lines.join('\n'));
    };

    $scope.zonesDifferInURL = function(urlZones) {
      if (urlZones.length != $scope.zones.length)
        return true;
      for (var i = 0; i < urlZones.length; i++) {
        if (urlZones[i] !== $scope.zones[i].urlKey)
          return true;
      }
      return false;
    };

    $scope.syncWithURL = function(initialSync) {
      if (localSearchChange) {
        localSearchChange = false;
        return;
      }

      var allZones = [];
      var homeZone = null;
      var params = $location.search();
      var dateChanged = false;
      var setToToday = false;

      initialSync = initialSync || false;

      var zoneString = params.tz;
      if (!params.tz && $scope.restoreTimezones)
        zoneString = loadFromStorage('lastTimezones');
      var zones = (zoneString || '').split(',');

      if (zones.length == 1 && zones[0] === '')
        zones = [];

      for (var i = 0; i < zones.length; i++) {
        var zoneName = zones[i];
        if (zoneName[zoneName.length - 1] == '!') {
          zoneName = zoneName.substr(0, zoneName.length - 1);
          homeZone = zoneName;
        }
        allZones.push(zoneName);
      }

      if (params.date) {
        var newDate = moment(params.date, 'YYYY-MM-DD');
        if (!moment(newDate).isSame(moment($scope.day))) {
          $scope.day = newDate.toDate();
          dateChanged = true;
        }
      } else {
        setToToday = true;
      }

      if (params.range) {
        var rangePieces = params.range.split(',');
        $scope.timeRange = [parseInt(rangePieces[0], 10),
                            parseInt(rangePieces[1], 10)];
        $scope.scheduleMeeting = true;
      } else {
        $scope.scheduleMeeting = false;
      }

      if (initialSync && allZones.length === 0) {
        var detectedHomeZoneState = getLocalTimeZoneState();
        if (detectedHomeZoneState)
          allZones = [detectedHomeZoneState.urlKey];
      }

      if (dateChanged || setToToday || $scope.zonesDifferInURL(allZones)) {
        $scope.homeZone = null;
        $scope.zones = [];

        if (homeZone === null && allZones.length > 0)
          homeZone = allZones[0];

        if (homeZone !== null)
          $scope.addZone(homeZone);
        for (i = 0; i < allZones.length; i++) {
          if (allZones[i] !== homeZone)
            $scope.addZone(allZones[i]);
        }

        $scope.sortByFunc(function(a, b) {
          var idx1 = allZones.indexOf(a.urlKey);
          var idx2 = allZones.indexOf(b.urlKey);
          return idx1 - idx2;
        });
        if (setToToday) {
          $scope.goToToday();
        } else {
          $scope.checkForToday();
        }
      }

      $scope.updateMeetingSummary();
    };

    window.setTimeout(function() {
      $scope.syncWithURL(true);
      $scope.$apply();
      $scope.ready = true;

      $scope.$on('$locationChangeSuccess', function() {
        $scope.syncWithURL(false);
      });

      $('div.loading').fadeOut('fast', function() {
        $('div.share').fadeIn('slow');
        $('div.contentwrapper').fadeIn('slow', function() {
          window.setInterval(function() {
            if ($scope.updateClocks()) {
              $scope.syncClockPointer();
              $scope.$apply();
            }
          }, 1000);
        });
      });
    }, 100);
  });

  timesched.directive('timezone', function() {
    return {
      restrict: 'ACE',
      require: 'ngModel',
      scope: {
        ngModel: '='
      },
      link: function(scope, elm, attrs, ctrl) {
        var localChange = false;

        elm.typeahead({
          name: 'timezone',
          local: SELECTABLES,
          limit: 6,
          engine: {compile: function() {
            return {
              render: function(context) {
                // TODO: escape just in case.
                var rv = '<p>' + context.value;
                try {
                  var now = moment().tz(context.z);
                  rv += '\u00a0<em>' + now.format('HH:mm') + '</em>';
                  rv += '\u00a0<small>' + now.format('z') + '</small>';
                } catch (e) {}
                return rv;
              }
            };
          }},
          template: 'dummy'
        });

        function updateScope() {
          var oldVal = elm.val();
          scope.$apply(function() {
            localChange = true;
            scope.ngModel = elm.val();
          });
          elm.val(oldVal);
        }

        elm.on('typeahead:selected', function() {
          ctrl.$setValidity('timezone', true);
          updateScope();
          elm.trigger('submit');
        });
        elm.on('typeahead:autocompleted', updateScope);

        elm.bind('input', function() {
          scope.$apply(function() {
            localChange = true;
            var value = elm.val();
            if (zoneExists(value)) {
              ctrl.$setValidity('timezone', true);
              scope.ngModel = value;
            } else {
              ctrl.$setValidity('timezone', false);
            }
          });
        });

        scope.$watch('ngModel', function(newVal) {
          if (localChange) {
            localChange = false;
            return;
          }
          elm.typeahead('setQuery', newVal || '');
        }, true);

        scope.$on('$destroy', function() {
          elm.typeahead('destroy');
        });
      }
    };
  });
})();

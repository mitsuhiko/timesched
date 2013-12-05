'use struct';

/* global moment */

var timesched = angular
  .module('timesched', ['ui.bootstrap', 'ui.sortable', 'ui.slider'])
  .config(function($locationProvider) {
    $locationProvider.html5Mode(true);
  });

(function() {
  var SELECTABLES = [];
  var SELECTABLES_BY_NAME = {};
  var SELECTABLES_BY_KEY = {};

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
      m = moment.tz(normalizeZoneName(zone.z));
    } catch (e) {
    }
    return m !== null ? new TimeZoneState(m, zone) : null;
  }

  timesched.setTimezoneData = function(data) {
    SELECTABLES = [];
    SELECTABLES_BY_NAME = {};
    SELECTABLES_BY_KEY = {};

    for (var i = 0; i < data.selectables.length; i++) {
      var sel = data.selectables[i];
      SELECTABLES.push(sel);
      SELECTABLES_BY_NAME[sel.d.toLowerCase()] = sel;
      SELECTABLES_BY_KEY[sel.k] = sel;
    }
  };

  function TimeZoneState(m, zone) {
    this.tz = m.tz();
    this.urlKey = zone.k;
    this.offset = 0;
    this.timezoneShortName = zone.n;
    this.timezoneName = zone.d;
    this.update();
  }

  TimeZoneState.prototype.update = function(day, homeZone) {
    var reftz = homeZone ? homeZone.tz : this.tz;
    var start = moment.tz(day, reftz).startOf('day');
    var ptr = start.clone().tz(this.tz);
    var offset = (start.zone() - ptr.zone()) / 60;

    this.dayStart = ptr.clone();
    this.homeOffset = (offset > 0 ? '+' : '') + offset;
    this.timezoneOffsetInfo = ptr.format('[UTC] Z');
    this.utcOffset = ptr.zone();
    this.timezoneAbbr = ptr.format('z');
    this.isHome = homeZone && homeZone.tz === this.tz;

    this.timeCells = [];
    for (var i = 0; i < 24; i++) {
      if (i !== 0)
        ptr.add('hours', 1);
      this.timeCells.push({
        hour: parseInt(ptr.format('H'), 10),
        hourFormat: ptr.format('H'),
        minute: parseInt(ptr.format('m'), 10),
        minuteFormat: ptr.format('mm'),
        tooltip: ptr.format('LLLL (z)')
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

    this.updateClock();
  };

  TimeZoneState.prototype.updateClock = function() {
    var now = moment.tz(this.tz);
    var oldH = this.clockHour;
    var oldM = this.clockMinute;
    this.clockHour = now.format('H');
    this.clockMinute = now.format('mm');
    return this.clockHour !== oldH || this.clockMinute !== oldM;
  };

  timesched.controller('TimezoneCtrl', function($scope, $location, datepickerConfig) {
    $scope.day = new Date();
    $scope.isToday = false;
    $scope.zones = [];
    $scope.homeZone = null;
    $scope.currentZone = null;
    $scope.ready = false;
    $scope.timeRange = [40, 68];
    $scope.scheduleMeeting = false;
    $scope.meetingSummary = '';

    // make the datepicker show monday by default
    datepickerConfig.startingDay = 1;

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
      var now = moment.tz($scope.homeZone.tz).format('YYYY-MM-DD');
      var dayStart = moment.tz($scope.day, $scope.homeZone.tz).format('YYYY-MM-DD');
      $scope.isToday = now == dayStart;
    };

    $scope.updateZones = function() {
      if (!$scope.zones.length)
        return;
      if ($scope.homeZone === null)
        $scope.homeZone = $scope.zones[0];
      $scope.zones.forEach(function(zone) {
        zone.update($scope.day, $scope.homeZone);
      });
    };

    $scope.$watch('day', function() {
      $scope.updateZones();
      $scope.saveState();
    });

    $scope.$watch('scheduleMeeting', function() {
      $scope.saveState();
    });

    $scope.$watch('timeRange', function() {
      $scope.saveState();
    });

    $scope.$watchCollection('zones', function() {
      $scope.saveState();
    });

    $scope.saveState = function() {
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
      if (params.tz != $location.search.tz ||
          params.date != $location.search.date ||
          params.range != $location.search.range)
        $location.search(params);

      if ($scope.scheduleMeeting)
        $scope.updateMeetingSummary();
    };

    $scope.updateMeetingSummary = function() {
      var lines = [];
      var fmt = 'HH:mm   ddd, MMM D YYYY';
      for (var i = 0; i < $scope.zones.length; i++) {
        var zone = $scope.zones[i];
        var start = zone.dayStart.clone().add('minutes', $scope.timeRange[0] * 15);
        var end = zone.dayStart.clone().add('minutes', $scope.timeRange[1] * 15);
        if (i > 0)
          lines.push('');
        lines.push(zone.timezoneName + '  [' + start.format('z; [UTC]ZZ') +
          (start.zone() != end.zone() ? '; timezone change' : '') + ']');
        lines.push(start.format(fmt));
        lines.push(end.format(fmt));
      }
      $scope.meetingSummary = lines.join('\n');
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

    $scope.syncWithURL = function() {
      var allZones = [];
      var homeZone = null;
      var params = $location.search();
      var zones = (params.tz || '').split(',');
      var dateChanged = false;
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
      }

      if (params.range) {
        var rangePieces = params.range.split(',');
        $scope.timeRange = [parseInt(rangePieces[0], 10),
                            parseInt(rangePieces[1], 10)];
        $scope.scheduleMeeting = true;
      } else {
        $scope.scheduleMeeting = false;
      }

      if (dateChanged || $scope.zonesDifferInURL(allZones)) {
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
        $scope.checkForToday();
      }
    };

    $scope.$on('$locationChangeSuccess', $scope.syncWithURL);
    window.setTimeout(function() {
      $scope.ready = true;
      $scope.syncWithURL();
      $('div.loading').hide();
      $('div.contentwrapper').fadeIn('slow', function() {
        window.setInterval(function() {
          if ($scope.updateClocks())
            $scope.$apply();
        }, 1000);
      });
    }, 100);
  });

  timesched.directive('timezone', function() {
    return {
      restrict: 'ACE',
      require: 'ngModel',
      scope: {
        datasets: '=',
        ngModel: '='
      },
      link: function(scope, elm, attrs, ctrl) {
        var localChange = false;

        elm.typeahead({
          name: 'timezone',
          local: SELECTABLES,
          valueKey: 'd',
          engine: {compile: function() {
            return {
              render: function(context) {
                var time;
                try {
                  time = moment.tz(context.z).format('HH:mm');
                } catch (e) {
                  time = '??:??';
                }
                return '<p>' + context.d + '\u00a0<em>' + time + '</em></p>';
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
            var value = elm.val();
            if (zoneExists(value)) {
              localChange = true;
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

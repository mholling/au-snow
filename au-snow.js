(function () {
  'use strict';

  angular.module('auSnow', [ 'ui.bootstrap', 'ngTouch' ])

  .config([ '$locationProvider', function($locationProvider) {
    $locationProvider.html5Mode(true);
  } ])

  .factory('flickrSearch', [ '$http', function($http) {
    return function(query) {
      var machine_tags = Object.keys(query).map(function(key) {
        return 'ausnow:' + key + '=' + (query[key] || '');
      }).join(',');
      return $http.get('https://api.flickr.com/services/rest/', {
        params: {
          method: 'flickr.photos.search',
          api_key: 'cef9b7cd3df5f75351acd80f60ff5b47',
          user_id: '97341623@N02',
          per_page: 500,
          extras: 'date_taken,url_o,machine_tags,description',
          format: 'json',
          machine_tags: machine_tags,
          machine_tag_mode: 'all',
          sort: 'date-taken-asc',
          nojsoncallback: 1,
        },
      });
    };
  } ])

  .controller('SnowController', [ 'flickrSearch', '$location', '$q', function(flickrSearch, $location, $q) {
    var self = this;

    this.states = [ 'nsw', 'vic' ]; // TODO: add Tasmania!

    this.years = [ ];
    var today = new Date();
    var lastYear = today.getFullYear() - (today.getMonth() < 4 ? 1  : 0 );
    for (var year = 2004; year <= lastYear; ++year) {
      this.years.push(String(year));
    }

    this.overlays = [ ];
    this.greatestHits = [ ];

    this.cache = { };
    this.states.forEach(function(state) {
      self.cache[state] = { };
      self.years.forEach(function(year) {
        self.cache[state][year] = { };
      });
    });

    this.loadCache = function(state, year) {
      var loadPhotos = function() {
        if (self.cache[state][year].photos)
          return $q.when();
        self.loading = true;
        return flickrSearch({ state: state, year: year}).success(function(data) {
          self.cache[state][year].photos = data.photos.photo.map(function(photo) {
            var parts = photo.datetaken.split(/[- :]/);
            var match = photo.machine_tags.match(/ausnow:satellite=(terra|aqua)/);
            var satellite = match && match[1];
            return {
              url: photo.url_o,
              date: new Date(parts[0], parts[1]-1, parts[2]),
              satellite: satellite,
              permalink: '?state=' + state + '&year=' + parts[0] + '&month=' + parts[1] + '&day=' + parts[2] + '&satellite=' + satellite,
              width: photo.width_o,
              height: photo.height_o,
            };
          });
          self.cache[state][year].photo = self.cache[state][year].photos[0];
          self.loading = false;
        }).error(function() {
          self.loading = false;
        });
      };

      var loadOverlays = function() {
        if (self.cache[state].overlays)
          return $q.when();
        return flickrSearch({ state: state, overlay: null }).success(function(data) {
          self.cache[state].overlays = data.photos.photo.map(function(photo) {
            var match = photo.machine_tags.match(/ausnow:overlay=([^\s]+)/);
            return {
              url: photo.url_o,
              name: match && match[1],
              active: false,
            };
          });
        });
      };

      return loadPhotos().then(loadOverlays);
    };

    this.loadGreatestHits = function() {
      return flickrSearch({ hit: null, state: null }).success(function(data) {
        self.greatestHits = data.photos.photo.map(function(photo) {
          var parts = photo.datetaken.split(/[- :]/);
          var satellite_match = photo.machine_tags.match(/ausnow:satellite=(terra|aqua)/);
          var state_match = photo.machine_tags.match(/ausnow:state=(nsw|vic)/);
          return {
            date: new Date(parts[0], parts[1]-1, parts[2]),
            state: state_match && state_match[1],
            satellite: satellite_match && satellite_match[1],
            comment: photo.description._content,
          };
        });
      });
    };

    this.updateStateAndYear = function(state, year) {
      if (this.state && this.year)
        this.cache[this.state][this.year].photo = this.photo;
      this.state = state;
      this.year = year;
      this.photos = this.cache[state][year].photos;
      this.photo = this.cache[state][year].photo;
      this.overlays = this.cache[state].overlays;
    };
    this.updatePhoto = function(date, satellite) {
      for (var index = 0; index < this.photos.length; ++index) {
        this.photo = this.photos[index];
        if (this.photo.date < date) { continue; }
        if (this.photo.date > date) { break; }
        if (!satellite) { break; }
        if (satellite == this.photo.satellite) { break; }
      }
    };

    this.setYear = function(year) {
      this.loadCache(this.state, year).then(function() {
        self.updateStateAndYear(self.state, year);
      });
    };
    this.setState = function(state) {
      this.loadCache(state, this.year).then(function() {
        self.updateStateAndYear(state, self.year);
      });
    };

    this.prev = function() {
      var index = this.photos.indexOf(this.photo);
      if (index > 0)
        this.photo = this.photos[index - 1];
    };
    this.next = function() {
      var index = this.photos.indexOf(this.photo);
      if (index < this.photos.length - 1)
        this.photo = this.photos[index + 1];
    };

    this.isFirst = function() {
      return this.photos.indexOf(this.photo) == 0;
    };
    this.isLast = function() {
      return this.photos.indexOf(this.photo) == this.photos.length - 1;
    };

    this.goTo = function(params) {
      var year = params.date.getFullYear();
      return this.loadCache(params.state, year).then(function() {
        self.updateStateAndYear(params.state, year);
        self.updatePhoto(params.date, params.satellite);
      });
    };

    this.countBy = function(n) {
      return n * Math.ceil(this.photos.length / n);
    };

    var start = {
      state: this.states.indexOf($location.search().state) < 0 ? this.states[0] : $location.search().state,
      satellite: $location.search().satellite,
      date: new Date(
        this.years.indexOf($location.search().year) < 0 ? this.years[this.years.length - 1] : $location.search().year,
        ($location.search().month || 1) - 1,
        $location.search().day || 1
      ),
    };

    this.goTo(start).then(function() {
      $location.search('').replace();
    }).then(this.loadGreatestHits);
  } ])

  .filter('ordinalIndicator', function() {
    return function(input) {
      var number = parseInt(input);
      switch(number % 10) {
        case 1:
          return (number + 90) % 100 === 1 ? 'th' : 'st';
        case 2:
          return (number + 90) % 100 === 2 ? 'th' : 'nd';
        case 3:
          return (number + 90) % 100 === 3 ? 'th' : 'rd';
        default:
          return 'th';
      }
    };
  })

  .directive("stopScreenMove", function() {
    return {
      restrict: 'A',
      scope: true,
      link: function(scope, element, attrs) {
        element.on("touchmove", function(event) {
          event.preventDefault();
        });
      },
    };
  });
}());

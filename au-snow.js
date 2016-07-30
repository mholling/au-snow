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

  .factory('flickrTagValues', [ '$http', function($http) {
    return function(predicate) {
      return $http.get('https://api.flickr.com/services/rest/', {
        params: {
          method: 'flickr.machinetags.getValues',
          api_key: 'cef9b7cd3df5f75351acd80f60ff5b47',
          namespace: 'ausnow',
          predicate: predicate,
          format: 'json',
          nojsoncallback: 1,
        },
      });
    };
  } ])

  .controller('SnowController', [ 'flickrSearch', 'flickrTagValues', '$location', '$q', function(flickrSearch, flickrTagValues, $location, $q) {
    var self = this;

    this.states = [ 'nsw', 'vic' ]; // TODO: add Tasmania!
    this.colours = [ 'truecolour', 'falsecolour' ];

    this.loadYears = function() {
      return flickrTagValues('year').success(function(data) {
        self.years = data.values.value.map(function(value) {
          return value._content;
        }).filter(function(year) {
          return year.match(/^2\d\d\d$/) && year >= 2004 && year <= new Date().getFullYear();
        });
        self.cache = { };
        self.states.forEach(function(state) {
          self.cache[state] = { };
          self.years.forEach(function(year) {
            self.cache[state][year] = { };
            self.colours.forEach(function(colour) {
              self.cache[state][year][colour] = { };
            });
          });
        });
      });
    };

    this.loadGreatestHits = function() {
      return flickrSearch({ hit: null, state: null }).success(function(data) {
        self.greatestHits = data.photos.photo.map(function(photo) {
          var parts = photo.datetaken.split(/[- :]/);
          var satellite_match = photo.machine_tags.match(/ausnow:satellite=(terra|suomi|aqua)/);
          var colour_match = photo.machine_tags.match(/ausnow:colour=(truecolour|falsecolour)/);
          var state_match = photo.machine_tags.match(/ausnow:state=(nsw|vic)/);
          return {
            date: new Date(parts[0], parts[1]-1, parts[2]),
            state: state_match && state_match[1],
            satellite: satellite_match && satellite_match[1],
            colour: colour_match && colour_match[1],
            description: photo.description._content,
          };
        });
      });
    };

    this.loadCache = function(state, year, colour) {
      var loadPhotos = function() {
        if (self.cache[state][year][colour].photos)
          return $q.when();
        self.loading = true;
        return flickrSearch({ state: state, year: year, colour: colour}).success(function(data) {
          self.cache[state][year][colour].photos = data.photos.photo.sort(function(photo1, photo2) {
            return photo1.datetaken < photo2.datetaken ? -1 : photo1.datetaken > photo2.datetaken ? 1 : 0;
          }).map(function(photo) {
            var parts = photo.datetaken.split(/[- :]/);
            var satellite_match = photo.machine_tags.match(/ausnow:satellite=(terra|suomi|aqua)/);
            var colour_match = photo.machine_tags.match(/ausnow:colour=(truecolour|falsecolour)/);
            var satellite = satellite_match && satellite_match[1];
            var colour = colour_match && colour_match[1];
            return {
              url: photo.url_o,
              date: new Date(parts[0], parts[1]-1, parts[2]),
              satellite: satellite,
              colour: colour,
              permalink: '?state=' + state + '&year=' + parts[0] + '&month=' + parts[1] + '&day=' + parts[2] + '&satellite=' + satellite + '&colour=' + colour,
              width: photo.width_o,
              height: photo.height_o,
            };
          }).reduce(function(result, photo, index, photos) {
            result.push(photo);
            if (index + 1 >= photos.length)
              return result;
            var diff = photos[index + 1].date - photo.date;
            if (diff <= 0)
              return result;
            if (photo.satellite == "terra")
              result.push(null);
            if (photos[index + 1].satellite != "terra")
              result.push(null);
            for (; diff > 86400000; diff -= 43200000)
              result.push(null);
            return result;
          }, [ ]);
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

    this.updateSet = function(state, year, colour) {
      this.state = state;
      this.year = year;
      this.colour = colour;
      this.photos = this.cache[state][year][colour].photos;
      this.overlays = this.cache[state].overlays;
    };
    this.updatePhoto = function(date, satellite, colour) {
      for (var index = 0; index < this.photos.length; ++index) {
        this.photo = this.photos[index];
        if (!this.photo) { continue; }
        if (this.photo.date < date) { continue; }
        if (this.photo.date > date) { break; }
        if (!satellite) { break; }
        if (satellite != this.photo.satellite) { break; }
      }
    };

    this.setYear = function(year) {
      this.loadCache(this.state, year, this.colour).then(function() {
        self.updateSet(self.state, year, self.colour);
        var date = new Date(year, self.photo.date.getMonth(), self.photo.date.getDate());
        self.updatePhoto(date, self.satellite, self.colour);
      });
    };
    this.setState = function(state) {
      this.loadCache(state, this.year, this.colour).then(function() {
        self.updateSet(state, self.year, self.colour);
        self.updatePhoto(self.photo.date, self.satellite, self.colour);
      });
    };
    this.setColour = function(colour) {
      this.loadCache(this.state, this.year, colour).then(function() {
        self.updateSet(self.state, self.year, colour);
        self.updatePhoto(self.photo.date, self.satellite, self.colour);
      });
    };

    this.prev = function() {
      for (var index = this.photos.indexOf(this.photo) - 1; index >= 0 && !this.photos[index]; --index) ;
      if (index >= 0)
        this.photo = this.photos[index];
    };
    this.next = function() {
      for (var index = this.photos.indexOf(this.photo) + 1; index < this.photos.length && !this.photos[index]; ++index) ;
      if (index < this.photos.length)
        this.photo = this.photos[index];
    };

    this.isFirst = function() {
      return this.photos.indexOf(this.photo) == 0;
    };
    this.isLast = function() {
      return this.photos.indexOf(this.photo) == this.photos.length - 1;
    };

    this.goTo = function(params) {
      var year = params.date.getFullYear();
      return this.loadCache(params.state, year, params.colour).then(function() {
        self.updateSet(params.state, year, params.colour);
        self.updatePhoto(params.date, params.satellite, params.colour);
      });
    };

    this.countBy = function(n) {
      return n * Math.ceil(this.photos.length / n);
    };

    this.loadYears().then(this.loadGreatestHits).then(function() {
      return self.goTo({
        state: self.states.indexOf($location.search().state) < 0 ? self.states[0] : $location.search().state,
        satellite: $location.search().satellite,
        colour: self.colours.indexOf($location.search().colour) < 0 ? self.colours[0] : $location.search().colour,
        date: new Date(
          self.years.indexOf($location.search().year) < 0 ? self.years[self.years.length - 1] : $location.search().year,
          ($location.search().month || 12) - 1,
          $location.search().day || 1
        ),
      });
    }).then(function() {
      $location.search('').replace();
    });
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

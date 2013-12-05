all: compress

compress: lib/generated/data.js
	uglifyjs \
		lib/angular.js \
		lib/jquery.js \
		lib/jquery-ui.js \
		lib/bootstrap/js/bootstrap.js \
		lib/sortable.js \
		lib/slider.js \
		lib/ui-bootstrap.js \
		lib/ui-bootstrap-tpls.js \
		lib/moment.js \
		lib/moment-timezone.js \
		lib/typeahead.js \
			> lib/generated/compressed.js
	uglifyjs \
		lib/generated/data.js \
			> lib/generated/compressed-data.js

download-timezone-info:
	wget https://raw.github.com/moment/moment-timezone/develop/moment-timezone.json -O data/timezones.json

lib/generated/data.js: data/*.json
	python data/convert.py


.PHONY: compress download-timezone-info

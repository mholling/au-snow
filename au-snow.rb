#!/usr/bin/env ruby

%w[date optparse tmpdir pathname uri open-uri flickraw].each { |file| require file }

date = Date.today
satellite = "terra"
FlickRaw.api_key = "cef9b7cd3df5f75351acd80f60ff5b47"

OptionParser.new("usage: au-snow.rb [options]") do |options|
  options.on "--date DATE", "date of satellite imagery" do |value|
    date = begin
      Date.parse value
    rescue ArgumentError
      options.abort "bad date"
    end
    options.abort "date is before 2004-10-23" unless date >= Date.new(2004, 10, 23)
    options.abort "date is in the future"     unless date <= Date.today
  end
  options.on "--satellite [terra|aqua]", "MODIS satellite", %w[terra aqua] do |value|
    satellite = value
  end
  options.on "--api-key KEY", "flickr API key" do |value|
    FlickRaw.api_key = value
  end
  options.on "--api-secret SECRET", "flickr API secret" do |value|
    FlickRaw.shared_secret = value
  end
  options.on "--access-token TOKEN", "flickr access token" do |value|
    flickr.access_token = value
  end
  options.on "--access-secret SECRET", "flickr access secret" do |value|
    flickr.access_secret = value
  end
end.parse!

Dir.mktmpdir do |dir|
  dir = Pathname.new(dir)
  specifiers = "%d%03d.%s.250m" % [ date.year, date.yday, satellite ]
  img, jgw, txt = [ %w[jpg jgw txt], %w[wb w w] ].transpose.map do |ext, flags|
    path = dir + "#{specifiers}.#{ext}"
    uri = URI.parse("http://lance-modis.eosdis.nasa.gov/imagery/subsets/?project=fas&subset=FAS_SEAustralia3.#{specifiers}.#{ext}")
    path.open(flags) { |file| file << uri.read }
    path
  end
  time = txt.read.each_line.grep(/^(\d\d):(\d\d) UTC/) do
    Time.utc(date.year, date.month, date.day, $1.to_i, $2.to_i)
  end.last.getlocal("+10:00")

  [
    [ "nsw", "147.768908 -35.414950 149.112564 -36.929548" ],
    [ "vic", "146.141080 -36.632428 147.541791 -37.918267" ],
  ].each do |state, window|
    title = "#{state}-#{date}-#{satellite}"
    set_title = "au-snow-#{state}"
    tif = dir + "#{title}.tif"
    jpg = dir + "#{title}.jpg"
    %x[gdal_translate -projwin #{window} "#{img}" "#{tif}"]
    %x[convert -quiet "#{tif}" "#{jpg}"]
    flickr.upload_photo(jpg, :title => title).tap do |id|
      flickr.photos.setDates(:photo_id => id, :date_taken => time.strftime("%F %T"))
      flickr.photos.setTags(:photo_id => id, :tags => "au-snow:year=#{date.year} au-snow:state=#{state} au-snow:satellite=#{satellite}")
      flickr.photos.setPerms(:photo_id => id, :is_public => 1, :is_friend => 0, :is_family => 1, :perm_comment => 0, :perm_addmeta => 0)
      flickr.photosets.getList.find do |set|
        set.title == set_title
      end.tap do |set|
        set ? flickr.photosets.addPhoto(:photoset_id => set.id, :photo_id => id) : flickr.photosets.create(:title => set_title, :primary_photo_id => id)
      end
    end unless flickr.photos.search(:user_id => "me", :text => title).any?
  end
end

#!/usr/bin/env ruby

%w[date optparse tmpdir pathname uri open-uri flickraw].each { |file| require file }

date = Date.today
satellite = "terra"
colour = true
FlickRaw.api_key = "cef9b7cd3df5f75351acd80f60ff5b47"
days = nil
quality = 60
tries = 1

OptionParser.new("usage: au-snow.rb [options]") do |options|
  options.on "--date DATE", "date of satellite imagery" do |value|
    date = begin
      Date.parse value
    rescue ArgumentError
      options.abort "bad date"
    end
  end
  options.on "--satellite [terra|suomi|aqua]", "satellite", %w[terra suomi aqua] do |value|
    satellite = value
  end
  options.on "--colour [true|false]", "colour", %w[true false] do |value|
    colour = value == "true"
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
  options.on "--tries TRIES", "limit upload attempts" do |value|
    tries = value.to_i
  end
  %w[start stop].each do |name|
    options.on "--#{name} #{name.upcase}", "#{name} date for batch download" do |value|
      date = {} unless Hash === date
      date[name] = begin
        Date.parse value
      rescue ArgumentError
        options.abort "bad #{name} date"
      end
    end
  end
  options.on "--quality QUALITY", "JPEG quality percentage" do |value|
    quality = value.to_i
  end
end.parse!

abort "false colour not available for MODIS Aqua" if satellite == "aqua" && !colour

UnavailableError = Class.new(StandardError);

def get(date, satellite, colour, quality, photosets)
  Dir.mktmpdir do |dir|
    outstanding = [
      [ "nsw", "147.768908 -36.929548 149.112564 -35.414950" ],
      [ "vic", "146.141080 -37.918267 147.541791 -36.632428" ],
    ].map do |state, window|
      title_parts = [ state, date, satellite ]
      title_parts << 'falsecolour' unless colour
      set_parts = [ 'au-snow', state ]
      set_parts << 'falsecolour' unless colour
      [ state, title_parts.join(?-), set_parts.join(?-), window ]
    end.reject do |state, title, set_title, window|
      flickr.photos.search(:user_id => "me", :text => title).any?
    end
    return false unless outstanding.any?
    
    dir = Pathname.new(dir)
    wms = dir + 'wms.xml'
    
    layer = case satellite
    when "terra" then colour ? "MODIS_Terra_CorrectedReflectance_TrueColor" : "MODIS_Terra_CorrectedReflectance_Bands367"
    when "suomi" then colour ?  "VIIRS_SNPP_CorrectedReflectance_TrueColor" :  "VIIRS_SNPP_CorrectedReflectance_BandsM3-I3-M11"
    when "aqua"  then           "MODIS_Aqua_CorrectedReflectance_TrueColor"
    end
    
    seconds = case satellite
    when "terra" then 37800 # 10:30
    when "suomi" then 48600 # 13:30
    when "aqua"  then 48600 # 13:30
    end
    
    wms.write <<-EOF
<GDAL_WMS>
    <Service name="TMS">
        <ServerUrl>http://map1.vis.earthdata.nasa.gov/wmts-geo/#{layer}/default/#{date}/EPSG4326_250m/${z}/${y}/${x}.jpg</ServerUrl>
    </Service>
    <DataWindow>
        <UpperLeftX>-180.0</UpperLeftX>
        <UpperLeftY>90</UpperLeftY>
        <LowerRightX>396.0</LowerRightX>
        <LowerRightY>-198</LowerRightY>
        <TileLevel>8</TileLevel>
        <TileCountX>2</TileCountX>
        <TileCountY>1</TileCountY>
        <YOrigin>top</YOrigin>
    </DataWindow>
    <Projection>EPSG:4326</Projection>
    <BlockSizeX>512</BlockSizeX>
    <BlockSizeY>512</BlockSizeY>
    <BandsCount>3</BandsCount>
</GDAL_WMS>
    EOF
    time = date.to_time.getlocal("+10:00") + seconds
    
    outstanding.each do |state, title, set_title, window|
      tif = dir + "#{title}.tif"
      jpg = dir + "#{title}.jpg"
      %x[gdalwarp -tr 0.002596125 -0.002248294118 -te #{window} "#{wms}" "#{tif}"]
      raise UnavailableError.new("data not available") unless $?.success?
      raise UnavailableError.new("data not available") if %x[convert "#{tif}" -quiet -format "%[mean]" info:] == ?0
      %x[convert -quiet "#{tif}" -quality #{quality}% "#{jpg}"]
      tags = %W[ausnow:year=#{date.year} ausnow:state=#{state} ausnow:satellite=#{satellite}]
      tags << "ausnow:type=falsecolour" unless colour
      flickr.upload_photo(jpg, :title => title, :tags => tags.join(?\s)).tap do |id|
        flickr.photos.setDates(:photo_id => id, :date_taken => time.strftime("%F %T"))
        flickr.photos.setPerms(:photo_id => id, :is_public => 1, :is_friend => 0, :is_family => 1, :perm_comment => 0, :perm_addmeta => 0)
        photosets.find do |set|
          set.title == set_title
        end.tap do |set|
          flickr.photosets.addPhoto(:photoset_id => set.id, :photo_id => id) if set
        end
      end
    end
    true
  end
end

if Hash === date
  photosets = flickr.photosets.getList
  Range.new(date["start"], date["stop"]).each do |date|
    %w[terra suomi aqua].each do |satellite|
      begin
        message = get(date, satellite, colour, quality, photosets) ? "downloaded" : "images already exist"
        STDOUT.puts "#{date} %5s %5s colour: #{message}" % [ satellite, colour ]
      rescue UnavailableError => e
        STDERR.puts "#{date} %5s %5s colour: #{e.message}" % [ satellite, colour ]
      rescue StandardError => e
        STDERR.puts "#{date} %5s %5s colour: #{e.message}" % [ satellite, colour ]
        STDERR.puts "retrying..."
        retry
      end
    end
  end
end

begin
  message = get(date, satellite, colour, quality, flickr.photosets.getList) ? "downloaded" : "images already exist"
  STDOUT.puts "#{date} #{satellite} #{colour}-colour: #{message}"
rescue UnavailableError => e
  abort       "#{date} #{satellite} #{colour}-colour: #{e.message}"
rescue StandardError => e
  STDERR.puts "#{date} #{satellite} #{colour}-colour: #{e.message}"
  abort unless (tries -= 1) > 0
  STDERR.puts "retrying..."
  retry
end unless Hash === date

-- =====================================================================
-- Curated supplement of recent flagship products that the Wikidata
-- snapshot may have missed. Idempotent via slug uniqueness.
-- Run anytime; finishes by refreshing the category mapping.
-- =====================================================================

insert into products (name, slug, manufacturer, kind, release_year, tags, aliases) values
-- Apple 2024 / 2025
('iPhone 16',              'iphone-16',              'Apple', 'hardware', 2024, '{apple,smartphone,ios,mobile,has-camera,has-touchscreen}', '{}'),
('iPhone 16 Plus',         'iphone-16-plus',         'Apple', 'hardware', 2024, '{apple,smartphone,ios,mobile,has-camera,has-touchscreen}', '{}'),
('iPhone 16 Pro',          'iphone-16-pro',          'Apple', 'hardware', 2024, '{apple,smartphone,ios,mobile,has-camera,has-touchscreen,premium}', '{}'),
('iPhone 16 Pro Max',      'iphone-16-pro-max',      'Apple', 'hardware', 2024, '{apple,smartphone,ios,mobile,has-camera,has-touchscreen,premium}', '{}'),
('iPhone 17 Pro',          'iphone-17-pro',          'Apple', 'hardware', 2025, '{apple,smartphone,ios,mobile,has-camera,has-touchscreen,premium}', '{}'),
('iPhone 17 Pro Max',      'iphone-17-pro-max',      'Apple', 'hardware', 2025, '{apple,smartphone,ios,mobile,has-camera,has-touchscreen,premium}', '{}'),
('iPhone 17',              'iphone-17',              'Apple', 'hardware', 2025, '{apple,smartphone,ios,mobile,has-camera,has-touchscreen}', '{}'),
('AirPods Pro 3',          'airpods-pro-3',          'Apple', 'hardware', 2025, '{apple,audio,wireless,earbuds,premium}', '{}'),
('AirPods 4',              'airpods-4',              'Apple', 'hardware', 2024, '{apple,audio,wireless,earbuds}', '{}'),
('Apple Watch Series 10',  'apple-watch-10',         'Apple', 'hardware', 2024, '{apple,wearable,watchos,has-touchscreen}', '{}'),
('Apple Watch Ultra 2',    'apple-watch-ultra-2',    'Apple', 'hardware', 2023, '{apple,wearable,watchos,has-touchscreen,premium}', '{}'),
('iPad Air M3',            'ipad-air-m3',            'Apple', 'hardware', 2025, '{apple,tablet,ipados,has-touchscreen,has-camera}', '{}'),
('iPad Pro M5',            'ipad-pro-m5',            'Apple', 'hardware', 2025, '{apple,tablet,ipados,has-touchscreen,has-camera,premium}', '{}'),
('iPad Mini (7th gen)',    'ipad-mini-7',            'Apple', 'hardware', 2024, '{apple,tablet,ipados,has-touchscreen,has-camera}', '{ipad mini}'),
('MacBook Air M3',         'macbook-air-m3',         'Apple', 'hardware', 2024, '{apple,laptop,macos,arm}', '{}'),
('MacBook Pro M4',         'macbook-pro-m4',         'Apple', 'hardware', 2024, '{apple,laptop,macos,arm,premium}', '{}'),
('Mac Studio M4 Max',      'mac-studio-m4',          'Apple', 'hardware', 2025, '{apple,desktop,macos,arm,premium}', '{mac studio}'),
('Mac mini M4',            'mac-mini-m4',            'Apple', 'hardware', 2024, '{apple,desktop,macos,arm}', '{}'),

-- Samsung 2024 / 2025
('Galaxy S24',             'galaxy-s24',             'Samsung', 'hardware', 2024, '{samsung,smartphone,android,mobile,has-camera,has-touchscreen}', '{}'),
('Galaxy S24+',            'galaxy-s24-plus',        'Samsung', 'hardware', 2024, '{samsung,smartphone,android,mobile,has-camera,has-touchscreen}', '{s24 plus}'),
('Galaxy S25',             'galaxy-s25',             'Samsung', 'hardware', 2025, '{samsung,smartphone,android,mobile,has-camera,has-touchscreen}', '{}'),
('Galaxy S25+',            'galaxy-s25-plus',        'Samsung', 'hardware', 2025, '{samsung,smartphone,android,mobile,has-camera,has-touchscreen}', '{s25 plus}'),
('Galaxy S25 Ultra',       'galaxy-s25-ultra',       'Samsung', 'hardware', 2025, '{samsung,smartphone,android,mobile,has-camera,has-touchscreen,premium,has-stylus}', '{s25 ultra}'),
('Galaxy Z Fold 6',        'galaxy-z-fold-6',        'Samsung', 'hardware', 2024, '{samsung,smartphone,android,mobile,has-camera,has-touchscreen,foldable,premium}', '{z fold 6}'),
('Galaxy Z Flip 6',        'galaxy-z-flip-6',        'Samsung', 'hardware', 2024, '{samsung,smartphone,android,mobile,has-camera,has-touchscreen,foldable}', '{z flip 6}'),
('Galaxy Z Fold 7',        'galaxy-z-fold-7',        'Samsung', 'hardware', 2025, '{samsung,smartphone,android,mobile,has-camera,has-touchscreen,foldable,premium}', '{z fold 7}'),
('Galaxy Z Flip 7',        'galaxy-z-flip-7',        'Samsung', 'hardware', 2025, '{samsung,smartphone,android,mobile,has-camera,has-touchscreen,foldable}', '{z flip 7}'),
('Galaxy Tab S10 Ultra',   'galaxy-tab-s10-ultra',   'Samsung', 'hardware', 2024, '{samsung,tablet,android,has-touchscreen,has-stylus,premium}', '{}'),
('Galaxy Watch 7',         'galaxy-watch-7',         'Samsung', 'hardware', 2024, '{samsung,wearable,wearos,has-touchscreen}', '{}'),
('Galaxy Buds 3 Pro',      'galaxy-buds-3-pro',      'Samsung', 'hardware', 2024, '{samsung,audio,wireless,earbuds,premium}', '{}'),

-- Google 2024 / 2025
('Pixel 9',                'pixel-9',                'Google', 'hardware', 2024, '{google,smartphone,android,mobile,has-camera,has-touchscreen,ai}', '{}'),
('Pixel 9 Pro',            'pixel-9-pro',            'Google', 'hardware', 2024, '{google,smartphone,android,mobile,has-camera,has-touchscreen,premium,ai}', '{}'),
('Pixel 9 Pro XL',         'pixel-9-pro-xl',         'Google', 'hardware', 2024, '{google,smartphone,android,mobile,has-camera,has-touchscreen,premium,ai}', '{}'),
('Pixel 9 Pro Fold',       'pixel-9-pro-fold',       'Google', 'hardware', 2024, '{google,smartphone,android,mobile,has-camera,has-touchscreen,foldable,premium,ai}', '{}'),
('Pixel 10',               'pixel-10',               'Google', 'hardware', 2025, '{google,smartphone,android,mobile,has-camera,has-touchscreen,ai}', '{}'),
('Pixel 10 Pro',           'pixel-10-pro',           'Google', 'hardware', 2025, '{google,smartphone,android,mobile,has-camera,has-touchscreen,premium,ai}', '{}'),
('Pixel Watch 3',          'pixel-watch-3',          'Google', 'hardware', 2024, '{google,wearable,wearos,has-touchscreen}', '{}'),
('Pixel Buds Pro 2',       'pixel-buds-pro-2',       'Google', 'hardware', 2024, '{google,audio,wireless,earbuds,premium}', '{}'),

-- Microsoft 2024 / 2025
('Surface Pro 11',         'surface-pro-11',         'Microsoft', 'hardware', 2024, '{microsoft,tablet,laptop,windows,arm,has-touchscreen,has-stylus,premium,ai}', '{}'),
('Surface Laptop Studio 2','surface-laptop-studio-2','Microsoft', 'hardware', 2023, '{microsoft,laptop,windows,has-touchscreen,has-stylus,premium}', '{}'),
('Xbox Series X (Galaxy Black)','xbox-series-x-2tb', 'Microsoft', 'hardware', 2024, '{microsoft,xbox,console,gaming,premium}', '{}'),

-- Sony / Nintendo / Valve 2024-2025
('Nintendo Switch 2',      'nintendo-switch-2',      'Nintendo', 'hardware', 2025, '{nintendo,console,gaming,handheld,has-touchscreen}', '{switch 2}'),
('PlayStation Portal',     'playstation-portal',     'Sony',     'hardware', 2023, '{sony,playstation,gaming,handheld,has-touchscreen,accessory}', '{}'),

-- Other notable hardware
('Sonos Ace',              'sonos-ace',              'Sonos',  'hardware', 2024, '{sonos,audio,wireless,headphones,premium}', '{}'),
('Bose Ultra Open Earbuds','bose-ultra-open',        'Bose',   'hardware', 2024, '{bose,audio,wireless,earbuds,premium}', '{}'),
('Insta360 X4',            'insta360-x4',            'Insta360','hardware', 2024, '{insta360,camera,has-camera,action-cam}', '{}'),
('GoPro Hero 13 Black',    'gopro-hero-13',          'GoPro',  'hardware', 2024, '{gopro,camera,has-camera,action-cam}', '{hero 13}'),
('DJI Air 3S',             'dji-air-3s',             'DJI',    'hardware', 2024, '{dji,drone,has-camera}', '{}'),
('DJI Osmo Pocket 3',      'dji-osmo-pocket-3-supp', 'DJI',    'hardware', 2023, '{dji,camera,has-camera,handheld}', '{}'),
('Ray-Ban Meta (2024)',    'rayban-meta-2024',       'Meta',   'hardware', 2024, '{meta,wearable,xr,has-camera,ai}', '{}'),

-- Software 2024 / 2025
('Apple Intelligence',     'apple-intelligence',     'Apple',     'software', 2024, '{apple,ai,os,mobile-app,desktop-app}', '{}'),
('iOS 18',                 'ios-18',                 'Apple',     'software', 2024, '{apple,os,mobile,ios}', '{}'),
('iPadOS 18',              'ipados-18',              'Apple',     'software', 2024, '{apple,os,tablet,ipados}', '{}'),
('macOS Sequoia',          'macos-sequoia',          'Apple',     'software', 2024, '{apple,os,desktop,macos}', '{}'),
('watchOS 11',             'watchos-11',             'Apple',     'software', 2024, '{apple,os,wearable,watchos}', '{}'),
('Android 15',             'android-15',             'Google',    'software', 2024, '{google,os,mobile,android,open-source}', '{}'),
('Cursor',                 'cursor',                 'Anysphere', 'software', 2023, '{ai,developer,desktop-app}', '{}'),
('Suno AI',                'suno-ai',                'Suno',      'software', 2023, '{ai,music,audio,creative,web-app}', '{suno}'),
('Runway',                 'runway-ml',              'Runway',    'software', 2018, '{ai,creative,video-editor,web-app}', '{runway ml}'),
('v0 by Vercel',           'v0-vercel',              'Vercel',    'software', 2023, '{ai,developer,web-app}', '{v0}'),
('Grok',                   'grok',                   'xAI',       'software', 2023, '{ai,web-app,mobile-app}', '{}'),
('Claude (model 4)',       'claude-4',               'Anthropic', 'software', 2025, '{ai,anthropic,web-app,mobile-app,desktop-app}', '{}'),
('ChatGPT-4o',             'chatgpt-4o',             'OpenAI',    'software', 2024, '{ai,openai,web-app,mobile-app,desktop-app}', '{}'),
('Gemini 2.0',             'gemini-2',               'Google',    'software', 2024, '{google,ai,web-app,mobile-app}', '{}'),
('Apple TV+',              'apple-tv-plus',          'Apple',     'software', 2019, '{apple,streaming,video,mobile-app,web-app,tv-app}', '{apple tv plus}')
on conflict (slug) do nothing;

-- Refresh mappings so the new products show up under their categories
select refresh_product_categories();

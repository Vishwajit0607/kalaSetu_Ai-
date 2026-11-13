const { getDefaultConfig } = require('expo/metro-config');
const { withNativeWind } = require('nativewind/metro');

const config = getDefaultConfig(__dirname);

// WatermelonDB ships a .wasm worker we never bundle on native.
config.resolver.assetExts = config.resolver.assetExts.filter((ext) => ext !== 'wasm');

module.exports = withNativeWind(config, { input: './global.css' });

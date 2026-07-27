/**
 * SEO slice barrel — stable require path for create-app + slices.
 */
const { registerSeoRoutes } = require('./routes');
const {
  entryByIdOrPrefix,
  normalizeAssetDirectoryType,
  normalizeContributorSort,
  entryPublicUrl,
  publicUrl,
} = require('./urls');

module.exports = {
  registerSeoRoutes,
  entryByIdOrPrefix,
  normalizeAssetDirectoryType,
  normalizeContributorSort,
  entryPublicUrl,
  publicUrl,
};

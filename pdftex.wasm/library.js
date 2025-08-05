mergeInto(LibraryManager.library, {
  // none of this is actually used any more
  kpse_find_file_js: function(nameptr, format, _mustexist) {
    return Asyncify.handleAsync(async () => {
      return await kpse_find_file_impl(nameptr, format, _mustexist);
    })
  },
  kpse_find_pk_js: function(nameptr, dpi) {
    return kpse_find_pk_impl(nameptr, dpi);
  }});
 
/**
 * A JavaScript implementation of a JSON-LD Processor.
 *
 * @author Dave Longley
 *
 * Copyright (c) 2011-2012 Digital Bazaar, Inc.
 */
(function() {

// define jsonld API
var jsonld = {};

/* Core API */

/**
 * Performs JSON-LD compaction.
 *
 * @param input the JSON-LD object to compact.
 * @param ctx the context to compact with.
 * @param [optimize] true to optimize the compaction (default: false).
 * @param callback(err, compacted) called once the operation completes.
 */
jsonld.compact = function(input, ctx) {
  // nothing to compact
  if(input === null) {
    return callback(null, null);
  }

  // get arguments
  var optimize = false;
  var callbackArg = 2;
  if(arguments.length > 3) {
    optimize = arguments[2];
    callbackArg += 1;
  }
  var callback = arguments[callbackArg];

  // performs clean up after compaction
  var cleanup = function(err, compacted, mergedCtx) {
    if(err) {
      return callback(err);
    }

    // determine if the original context uses URLs or not
    var usesUrls = _isString(ctx);
    if(!usesUrls && _isArray(ctx)) {
      for(var i in ctx) {
        if(_isString(ctx[i])) {
          usesUrls = true;
          break;
        }
      }
    }

    // if ctx uses URLs, consider it already optimized
    if(!optimize || usesUrls) {
      if(!_isObject(ctx) || Object.keys(ctx).length > 0) {
        compacted['@context'] = ctx;
      }
    }
    // optimize context
    else {
      // only include terms used in the output in the context
      ctx = _optimizeContext(compacted, mergedCtx);
      if(Object.keys(ctx).length > 0) {
        compacted['@context'] = ctx;
      }
    }

    callback(err);
  };

  // expand input then do compaction
  jsonld.expand(input, function(err, expanded) {
    if(err) {
      return callback(new JsonLdError(
        'Could not expand input before compaction.',
        'jsonld.CompactError', {cause: err}));
    }

    // merge and resolve contexts
    jsonld.mergeContexts({}, ctx, function(err, ctx) {
      if(err) {
        return callback(new JsonLdError(
          'Could not merge context before compaction.',
          'jsonld.CompactError', {cause: err}));
      }

      try {
        // do compaction
        var compacted = new Processor().compact(ctx, null, input, optimize);
        cleanup(null, compacted, ctx);
      }
      catch(ex) {
        cleanup(err);
      }
    });
  });
};

/**
 * Performs JSON-LD expansion.
 *
 * @param input the JSON-LD object to expand.
 * @param callback(err, expanded) called once the operation completes.
 */
jsonld.expand = function(input, callback) {
  // resolve all @context URLs in the input
  input = _clone(input);
  _resolveUrls(input, function(err, input) {
    if(err) {
      return callback(err);
    }
    // do expansion
    new Processor().expand({}, null, input, callback);
  });
};

/**
 * Performs JSON-LD framing.
 *
 * @param input the JSON-LD object to frame.
 * @param frame the JSON-LD frame to use.
 * @param [options] the framing options.
 * @param callback(err, framed) called once the operation completes.
 */
jsonld.frame = function(input, frame) {
  // get arguments
  var options = {};
  var callbackArg = 2;
  if(arguments.length > 3) {
    options = arguments[2];
    callbackArg += 1;
  }
  var callback = arguments[callbackArg];

  // resolve all @context URLs in the input
  input = _clone(input);
  frame = _clone(frame);
  _resolveUrls(input, function(err, input) {
    if(err) {
      return callback(err);
    }
    // resolve all @context URLs in the frame
    _resolveUrls(input, function(err, input) {
      if(err) {
        return callback(err);
      }
      // FIXME: might need to pass original context or do compaction
      // outside of framing here... or create common function for adding
      // a context to compacted output?
      // do framing
      new Processor().frame(input, frame, options, callback);
    });
  });
};

/**
 * Performs JSON-LD normalization.
 *
 * @param input the JSON-LD object to normalize.
 * @param callback(err, normalized) called once the operation completes.
 */
jsonld.normalize = function(input, callback) {
  // resolve all @context URLs in the input
  input = _clone(input);
  _resolveUrls(input, function(err, input) {
    if(err) {
      return callback(err);
    }
    // do normalization
    return new Processor().normalize(input, callback);
  });
};

/**
 * Outputs the triples found in the given JSON-LD object.
 *
 * @param input the JSON-LD object.
 * @param callback(err, triple) called when a triple is output, with the last
 *          triple as null.
 */
jsonld.triples = function(input, callback) {
  // resolve all @context URLs in the input
  input = _clone(input);
  _resolveUrls(input, function(err, input) {
    if(err) {
      return callback(err);
    }
    // output triples
    return new Processor().triples(input, callback);
  });
};

/**
 * The default URL resolver for external @context URLs.
 *
 * @param resolver(url, callback(err, ctx)) the resolver to use.
 */
jsonld.urlResolver = function(url, callback) {
  return callback(new JsonLdError(
    'Could not resolve @context URL. URL resolution not implemented.',
    'jsonld.ContextUrlError'));
};

/* Utility API */

/**
 * URL resolvers.
 */
jsonld.urlResolvers = {};

/**
 * The built-in jquery URL resolver.
 */
jsonld.urlResolvers['jquery'] = function($) {
  jsonld.urlResolver = function(url, callback) {
    $.ajax({
      url: url,
      dataType: 'json',
      crossDomain: true,
      success: function(data, textStatus, jqXHR) {
        callback(null, data);
      },
      error: function(jqXHR, textStatus, errorThrown) {
        callback(errorThrown);
      }
    });
  };
};

/**
 * Assigns the default URL resolver for external @context URLs to a built-in
 * default. Supported types currently include: 'jquery'.
 *
 * To use the jquery URL resolver, the 'data' parameter must be a reference
 * to the main jquery object.
 *
 * @param type the type to set.
 * @param [params] the parameters required to use the resolver.
 */
jsonld.useUrlResolver = function(type) {
  if(!(type in jsonld.urlResolvers)) {
    throw new JsonLdError(
      'Unknown @context URL resolver type: "' + type + '"',
      'jsonld.UnknownUrlResolver',
      {type: type});
  }

  // set URL resolver
  jsonld.urlResolvers[type].apply(arguments.slice(1));
};

/**
 * Merges one context with another, resolving any URLs as necessary.
 *
 * @param ctx1 the context to overwrite/append to.
 * @param ctx2 the new context to merge onto ctx1.
 * @param callback(err, ctx) called once the operation completes.
 */
jsonld.mergeContexts = function(ctx1, ctx2, callback) {
  // default to empty contexts
  ctx1 = _clone(ctx1 || {});
  ctx2 = _clone(ctx2 || {});

  // resolve URLs in ctx1
  _resolveUrls({'@context': ctx1}, function(err, ctx1) {
    if(err) {
      return callback(err);
    }
    // resolve URLs in ctx2
    _resolveUrls({'@context': ctx2}, function(err, ctx2) {
      if(err) {
        return callback(err);
      }
      try {
        // do merge
        var merged = new Processor().mergeContexts(
          ctx1['@context'], ctx2['@context']);
        callback(null, merged);
      }
      catch(ex) {
        callback(ex);
      }
    });
  });
};

/**
 * Returns true if the given subject has the given property.
 *
 * @param subject the subject to check.
 * @param property the property to look for.
 *
 * @return true if the subject has the given property, false if not.
 */
jsonld.hasProperty = function(subject, property) {
  var rval = false;
  if(property in subject) {
    var value = subject[property];
    rval = (!_isArray(value) || value.length > 0);
  }
  return rval;
};

/**
 * Determines if the given value is a property of the given subject.
 *
 * @param subject the subject to check.
 * @param property the property to check.
 * @param value the value to check.
 *
 * @return true if the value exists, false if not.
 */
jsonld.hasValue = function(subject, property, value) {
  var rval = false;
  if(jsonld.hasProperty(subject, property)) {
    var val = subject[property];
    if(_isArray(val)) {
      rval = (indexOf(val, value) !== -1);
    }
    // avoid matching the set of values with an array value parameter
    else if(!_isArray(value)) {
      rval = (val === value);
    }
  }
  return rval;
};

/**
 * Adds a value to a subject. If the subject already has the value, it will
 * not be added.
 *
 * @param subject the subject to add the value to.
 * @param property the property that relates the value to the subject.
 * @param value the value to add.
 * @param [propertyIsArray] true if the property is always an array, false
 *          if not (default: false).
 */
jsonld.addValue = function(subject, property, value, propertyIsArray) {
  propertyIsArray = _isUndefined(propertyIsArray) ? false : propertyIsArray;

  if(property in subject) {
    var hasValue = !jsonld.hasValue(subject, property, value);

    // make property an array if value not present or always a set
    if(!_isArray(subject[property]) && (!hasValue || propertyIsArray)) {
      subject[property] = [subject[property]];
    }

    // add new value
    if(!hasValue) {
      subject[property].push(value);
    }
  }
  else {
    // add new value as set or single value
    subject[property] = propertyIsArray ? [value] : value;
  }
};

/**
 * Gets all of the values for a subject's property as an array.
 *
 * @param subject the subject.
 * @param property the property.
 *
 * @return all of the values for a subject's property as an array.
 */
jsonld.getValues = function(subject, property) {
  var rval = subject[property] || [];
  if(!_isArray(rval)) {
    rval = [rval];
  }
  return rval;
};

/**
 * Removes a property from a subject.
 *
 * @param subject the subject.
 * @param property the property.
 */
jsonld.removeProperty = function(subject, property) {
  delete subject[property];
};

/**
 * Removes a value from a subject.
 *
 * @param subject the subject.
 * @param property the property that relates the value to the subject.
 * @param value the value to remove.
 * @param [propertyIsArray] true if the property is always an array, false
 *          if not (default: false).
 */
jsonld.removeValue = function(subject, property, value, propertyIsArray) {
  propertyIsArray = _isUndefined(propertyIsArray) ? false : propertyIsArray;

  // filter out value
  var values = jsonld.getValues(subject, property).filter(function(e) {
    return e !== value;
  });

  if(values.length === 0) {
    jsonld.removeProperty(subject, property);
  }
  else if(values.length === 1 && !propertyIsArray) {
    subject[property] = values[0];
  }
  else {
    subject[property] = values;
  }
};

/**
 * Gets the value for the given @context key and type, null if none is set.
 *
 * @param ctx the context.
 * @param key the context key.
 * @param [type] the type of value to get (eg: '@id', '@type'), if not
 *          specified gets the entire entry for a key, null if not found.
 * @param [expand] true to expand the value, false not to (default: true).
 *
 * @return the value.
 */
jsonld.getContextValue = function(ctx, key, type, expand) {
  var rval = null;

  // return entire context entry if type is unspecified
  if(_isUndefined(type)) {
    rval = ctx[key] || null;
  }
  else if(key in ctx) {
    if(_isObject(ctx[key])) {
      if(type in ctx[key]) {
        rval = ctx[key][type];
      }
    }
    else if(type === '@id' && _isString(ctx[key])) {
      rval = ctx[key];
    }
    else {
      throw new JsonLdError(
        'Invalid @context value.',
        'jsonld.InvalidContext',
        {context: ctx2, key: key});
    }

    // expand term if requested
    expand = _isUndefined(expand) ? true : expand;
    if(expand) {
      rval = _expandTerm(ctx, rval);
    }
  }

  return rval;
};

// determine if in-browser or using node.js
var _nodejs = (!_isUndefined(module) && module.exports);
var _browser = !_nodejs;

// export nodejs API
if(_nodejs) {
  module.exports = jsonld;
  var crypto = require('crypto');
}

// export browser API
if(_browser) {
  window.jsonld = window.jsonld || jsonld;
}

// xsd constants
var XSD = {
  'boolean': 'http://www.w3.org/2001/XMLSchema#boolean',
  'double': 'http://www.w3.org/2001/XMLSchema#double',
  'integer': 'http://www.w3.org/2001/XMLSchema#integer'
};

/**
 * A JSON-LD Error.
 *
 * @param msg the error message.
 * @param type the error type.
 * @param details the error details.
 */
var JsonLdError = function(msg, type, details) {
  if(_nodejs) {
    Error.call(this, msg);
  }
  this.msg = msg;
  this.type = type;
  this.details = details;
};
if(_nodejs) {
  require('util').inherits(JsonLdError, Error);
}

/**
 * Constructs a new JSON-LD Processor.
 */
var Processor = function() {};

/**
 * Recursively compacts a value using the given context. All context URLs
 * must have been resolved before calling this method and all values must
 * be in expanded form.
 *
 * @param ctx the context to use.
 * @param property the property that points to the value, null for none.
 * @param value the value to compact.
 * @param optimize true to optimize the compaction.
 *
 * @return the compacted value.
 */
Processor.prototype.compact = function(ctx, property, value, optimize) {
  // null is already compact
  if(value === null) {
    return null;
  }

  // recursively compact array or list
  var isList = _isListValue(value);
  if(_isArray(value) || isList) {
    // get array from @list
    if(isList) {
      value = value['@list'];

      // nothing to compact in null case
      if(value === null) {
        return null;
      }
      // invalid input if @list points at a non-array
      else if(!_isArray(value)) {
        throw new JsonLdError(
          'Invalid JSON-LD syntax; "@list" value must be an array or null.',
          'jsonld.SyntaxError');
      }
    }

    // recurse through array
    var rval = [];
    for(var i in value) {
      var val = value[i];
      if(_isArray(val)) {
        throw new JsonLdError(
          'Invalid JSON-LD syntax; arrays of arrays are not permitted.',
          'jsonld.SyntaxError');
      }
      rval.push(this.compact(ctx, property, val));
    }

    // use @list if previously used unless @context specifies container @list
    var container = jsonld.getContextValue(ctx, property, '@container');
    var useList = isList && (container !== '@list');
    if(useList) {
      rval = {'@list': rval};
    }
    return rval;
  }

  // replace '@graph' keyword and recurse
  if(_isObject(value) && '@graph' in value) {
    var graph = _getKeywords(ctx)['@graph'];
    var rval = {};
    rval[graph] = this.compact(ctx, property, value['@graph'], optimize);
    return rval;
  }

  // recursively compact subject
  if(_isSubject(value)) {
    rval = {};
    for(var key in value) {
      // compact non-context
      if(key !== '@context') {
        // drop unmapped and non-absolute IRI keys
        if(!jsonld.getContextValue(key) && !_isAbsoluteIri(key)) {
          continue;
        }

        // compact property and value
        var p = _compactIri(ctx, key);
        var val = this.compact(ctx, key, value[key]);

        // determine if an array should be used by @container specification
        var container = jsonld.getContextValue(ctx, p, '@container');
        var isArray = (container === '@set' || container === '@list');

        // add compacted value
        jsonld.addValue(rval, p, val, isArray);
      }
    }
    return rval;
  }

  // optimize away use of @set
  if(_isSetValue(value)) {
    return this.compact(ctx, property, value['@set']);
  }

  // compact value
  return this.compactValue(ctx, property, value);
};

/**
 * Recursively expands a value using the given context. Any context in
 * the value will be removed. All context URLs must have been resolved before
 * calling this method.
 *
 * @param ctx the context to use.
 * @param property the property that points to the value, null for none.
 * @param value the value to expand.
 */
Processor.prototype.expand = function(ctx, property, value) {
  // nothing to expand when value is null
  if(value === null) {
    return null;
  }

  // if no property is specified and the value is a string (this means the
  // value is a property itself), expand to an IRI
  if(property === null && _isString(value)) {
    return _expandTerm(ctx, value);
  }

  // recursively expand array and @list
  var isList = value;
  if(_isArray(value) || isList) {
    // get array from @list
    if(isList) {
      value = value['@list'];

      // nothing to expand in null case
      if(value === null) {
        return null;
      }
      // invalid input if @list points at a non-array
      else if(!_isArray(value)) {
        throw new JsonLdError(
          'Invalid JSON-LD syntax; "@list" value must be an array or null.',
          'jsonld.SyntaxError');
      }
    }

    // recurse through array
    var rval = [];
    for(var i in value) {
      var val = value[i];
      if(_isArray(val)) {
        throw new JsonLdError(
          'Invalid JSON-LD syntax; arrays of arrays are not permitted.',
          'jsonld.SyntaxError');
      }
      rval.push(this.expand(ctx, property, val));
    }

    // use @list if previously used or if @context indicates it is one
    var container = jsonld.getContextValue(ctx, property, '@container');
    isList = isList || (container === '@list');
    if(isList) {
      rval = {'@list': rval};
    }
    return rval;
  }

  // recursively expand subject
  if(_isSubject(value)) {
    // if value has a context, merge it in
    if('@context' in value) {
      ctx = this.merge(ctx, value['@context']);
    }

    var rval = {};
    for(var key in value) {
      // preserve frame keywords
      if(_isFrameKeyword(key)) {
        jsonld.addValue(rval, key, value[key], true);
      }
      // expand non-context
      else if(key !== '@context') {
        // drop unmapped and non-absolute IRI keys
        if(!jsonld.getContextValue(key) && !_isAbsoluteIri(key)) {
          continue;
        }

        // expand property and value
        var prop = _expandTerm(ctx, key);
        var val = this.expand(ctx, key, value[key]);

        // add non-null expanded value
        if(val !== null) {
          jsonld.addValue(rval, prop, val, true);
        }
      }
    }
    return rval;
  }

  // optimize away use of @set
  if(_isSetValue(value)) {
    return this.expand(ctx, property, value['@set']);
  }

  // expand value
  return this.expandValue(ctx, property, value);
};

/**
 * Performs JSON-LD framing.
 *
 * @param input the JSON-LD object to frame.
 * @param frame the JSON-LD frame to use.
 * @param options the framing options.
 * @param callback(err, framed) called once the operation completes.
 */
Processor.prototype.frame = function(input, frame, options, callback) {
  // FIXME: implement
  callback(new JsonLdError('Not implemented', 'jsonld.NotImplemented'), null);
};

/**
 * Performs JSON-LD normalization.
 *
 * @param input the JSON-LD object to normalize.
 * @param callback(err, normalized) called once the operation completes.
 */
Processor.prototype.normalize = function(input, callback) {
  // FIXME: implement
  callback(new JsonLdError('Not implemented', 'jsonld.NotImplemented'), null);
};

/**
 * Outputs the triples found in the given JSON-LD object.
 *
 * @param input the JSON-LD object.
 * @param callback(err, triple) called when a triple is output, with the last
 *          triple as null.
 */
Processor.prototype.triples = function(input, callback) {
  // FIXME: implement
  callback(new JsonLdError('Not implemented', 'jsonld.NotImplemented'), null);
};

/**
 * Merges a context onto another.
 *
 * @param ctx1 the original context.
 * @param ctx2 the new context to merge in.
 *
 * @return the resulting merged context.
 */
Processor.prototype.mergeContexts = function(ctx1, ctx2) {
  // flatten array context
  if(_isArray(ctx1)) {
    ctx1 = this.mergeContexts({}, ctx1);
  }

  // init return value as copy of first context
  var rval = _clone(ctx1);

  if(_isArray(ctx2)) {
    // flatten array context in order
    for(var i in ctx2) {
      rval = this.mergeContexts(rval, ctx2[i]);
    }
  }
  else {
    // if the ctx2 has a new definition for an IRI (possibly using a new
    // key), then the old definition must be removed
    for(var key in ctx2) {
      var newIri = jsonld.getContextValue(ctx2, key, '@id');

      // no IRI defined, skip
      if(newIri === null) {
        continue;
      }

      for(var mkey in rval) {
        // matching IRI, remove old entry
        if(newIri === jsonld.getContextValue(rval, mkey, '@id')) {
          delete rval[mkey];
          break;
        }
      }
    }

    // merge contexts
    for(var key in ctx2) {
      rval[key] = ctx2[key];
    }
  }

  return rval;
};

/**
 * Expands the given value by using the coercion and keyword rules in the
 * given context.
 *
 * @param ctx the context to use.
 * @param property the property the value is associated with.
 * @param value the value to expand.
 *
 * @return the expanded value.
 */
Processor.prototype.expandValue = function(ctx, property, value) {
  // default to simple string return value
  var rval = value;

  // expand property
  var prop = _expandTerm(ctx, property);

  // special-case expand @id and @type (skips '@id' expansion)
  if(prop === '@id' || prop === '@type') {
    rval = _expandTerm(ctx, value);
  }
  else {
    // compact property to look for its type definition in the context
    prop = _compactIri(ctx, prop);
    var type = jsonld.getContextValue(ctx, prop, '@type');

    // no type found in context, handle special double-case
    if(type === null && _isDouble(value)) {
      // do special JSON-LD double format, printf('%1.16e') JS equivalent
      value = value.toExponential(16).replace(
        /(e(?:\+|-))([0-9])$/, '$10$2');
    }

    // do @id expansion
    if(type === '@id') {
      rval = {'@id': _expandTerm(ctx, value)};
    }
    // other type
    else if(type !== null) {
      rval = {'@type': type, '@value': '' + value};
    }
  }

  return rval;
};

/**
 * Compacts an expanded value by using the coercion and keyword rules in the
 * given context.
 *
 * @param ctx the context to use.
 * @param property the property the value is associated with.
 * @param value the value to compact.
 *
 * @return the compacted value.
 */
Processor.prototype.compactValue = function(ctx, property, value) {
  // non-objects are already compact
  if(!_isObject(value)) {
    return value;
  }

  // default to no compaction
  var rval = value;

  // get the type specified by the context
  var type = null;

  // expand property
  var prop = _expandTerm(ctx, property);

  // type for '@id' or '@type' is always '@id'
  if(prop === '@id' || prop === '@type') {
    type = '@id';
  }
  else {
    // compact property to look for its type definition in the context
    prop = _compactIri(ctx, prop);
    type = jsonld.getContextValue(ctx, prop, '@type');
  }

  // no type, do keyword replacement
  if(type === null) {
    var keywords = _getKeywords(ctx);
    rval = {};
    for(var key in value) {
      // compact @id and @type IRIs
      var val = value[key];
      if(key === '@id' || key === '@type') {
        val = _compactIri(ctx, value[key]);
      }
      rval[keywords[key]] = val;
    }
  }
  // can't type-coerce when a language is present
  else if('@language' in value) {
    throw new JsonLdError(
      'Cannot compact a typed value when a language is specified because ' +
      'the language information would be lost.',
      'jsonld.CompactError', {context: ctx, value: value});
  }
  // compact IRI
  else if(type === '@id') {
    rval = _compactIri(ctx, value['@value']);
  }
  // other type
  else {
    rval = value['@value'];
  }

  return rval;
};

/**
 * Compacts an IRI into a term or prefix if it can be.
 *
 * @param ctx the context to use.
 * @param iri the IRI to compact.
 *
 * @return the compacted IRI as a term or prefix or the original IRI.
 */
function _compactIri(ctx, iri) {
  // check the context for a term that could shorten the IRI
  // (give preference to terms over prefixes)
  for(var key in ctx) {
    // skip special context keys (start with '@')
    if(key.length > 0 && key[0] !== '@') {
      // compact to a term
      if(iri === jsonld.getContextValue(ctx, key, '@id')) {
        return key;
      }
    }
  }

  // term not found, if term is keyword, use alias
  var keywords = _getKeywords(ctx);
  if(iri in keywords) {
    return keywords[iri];
  }

  // term not found, check the context for a prefix
  for(var key in ctx) {
    // skip special context keys (start with '@')
    if(key.length > 0 && key[0] !== '@') {
      // see if IRI begins with the next IRI from the context
      var ctxIri = jsonld.getContextValue(ctx, key, '@id');
      if(ctxIri !== null) {
        // compact to a prefix
        var idx = iri.indexOf(ctxIri);
        if(idx === 0 && iri.length > ctxIri.length) {
          return key + ':' + iri.substr(ctxIri.length);
        }
      }
    }
  }

  // could not compact IRI, return it as is
  return iri;
}

/**
 * Expands a term into an absolute IRI. The term may be a regular term, a
 * prefix, a relative IRI, or an absolute IRI. In any case, the associated
 * absolute IRI will be returned.
 *
 * @param ctx the context to use.
 * @param term the term to expand.
 * @param deep (used internally to recursively expand).
 *
 * @return the expanded term as an absolute IRI.
 */
function _expandTerm(ctx, term, deep) {
  // default to the term being fully-expanded or not in the context
  var rval = term;

  // 1. If the property has a colon, it is a prefix or an absolute IRI:
  var idx = term.indexOf(':');
  if(idx !== -1) {
    // get the potential prefix
    var prefix = term.substr(0, idx);

    // expand term if prefix is in context, otherwise leave it be
    if(prefix in ctx) {
      // prefix found, expand property to absolute IRI
      var iri = jsonld.getContextValue(ctx, prefix, '@id');
      rval = iri + term.substr(idx + 1);
    }
  }
  // 2. If the property is in the context, then it's a term.
  else if(term in ctx) {
    rval = jsonld.getContextValue(ctx, term, '@id', false);
  }
  // 3. The property is a keyword or not in the context.
  else {
    var keywords = _getKeywords(ctx);
    for(var key in keywords) {
      if(term === keywords[key]) {
        rval = key;
        break;
      }
    }
  }

  // recursively expand the term
  if(_isUndefined(deep)) {
    var cycles = {};
    var recurse = null;
    while(recurse !== rval) {
      if(rval in cycles) {
        throw new JsonLdError(
          'Cyclical term definition detected in context.',
          'jsonld.CyclicalContext',
          {context: ctx, term: rval});
      }
      else {
        cycles[rval] = true;
      }
      recurse = rval;
      recurse = _expandTerm(ctx, recurse, true);
    }
    rval = recurse;
  }

  return rval;
}

/**
 * Gets the keywords from a context.
 *
 * @param ctx the context.
 *
 * @return the keywords.
 */
function _getKeywords(ctx) {
  var rval = {
    '@container': '@container',
    '@graph': '@graph',
    '@id': '@id',
    '@language': '@language',
    '@list': '@list',
    '@set': '@set',
    '@type': '@type',
    '@value': '@value'
  };

  if(ctx) {
    // gather keyword aliases from context
    var keywords = {};
    for(var key in ctx) {
      if(_isString(ctx[key]) && ctx[key] in rval) {
        keywords[ctx[key]] = key;
      }
    }

    // overwrite keywords
    for(var key in keywords) {
      rval[key] = keywords[key];
    }
  }

  return rval;
}

/**
 * Returns true if the given key is a frame keyword.
 *
 * @param key the key to check.
 *
 * @return true if the key is a frame keyword, false if not.
 */
function _isFrameKeyword(key) {
  return (
    key === '@embed' ||
    key === '@explicit' ||
    key === '@default' ||
    key === '@omitDefault');
}

/**
 * Returns true if the given input is an Object.
 *
 * @param input the input to check.
 *
 * @return true if the input is an Object, false if not.
 */
function _isObject(input) {
  return (input && input.constructor === Object);
}

/**
 * Returns true if the given input is an Array.
 *
 * @param input the input to check.
 *
 * @return true if the input is an Array, false if not.
 */
function _isArray(input) {
  return (input && input.constructor === Array);
}

/**
 * Returns true if the given input is a String.
 *
 * @param input the input to check.
 *
 * @return true if the input is a String, false if not.
 */
function _isString(input) {
  return (input && input.constructor === String);
}

/**
 * Returns true if the given input is a Number.
 *
 * @param input the input to check.
 *
 * @return true if the input is a Number, false if not.
 */
function _isNumber(input) {
  return (input && input.constructor === Number);
}

/**
 * Returns true if the given input is a double.
 *
 * @param input the input to check.
 *
 * @return true if the input is a double, false if not.
 */
function _isDouble(input) {
  return _isNumber(input) && ('' + input).indexOf('.') !== -1;
}

/**
 * Returns true if the given input is a Boolean.
 *
 * @param input the input to check.
 *
 * @return true if the input is a Boolean, false if not.
 */
function _isBoolean(input) {
  return (input && input.constructor === Boolean);
}

/**
 * Returns true if the given input is undefined.
 *
 * @param input the input to check.
 *
 * @return true if the input is undefined, false if not.
 */
function _isUndefined(input) {
  return (typeof input === 'undefined');
}

/**
 * Returns true if the given value is a subject with properties.
 *
 * @param value the value to check.
 *
 * @return true if the value is a subject with properties, false if not.
 */
function _isSubject(value) {
  var rval = false;

  // Note: A value is a subject if all of these hold true:
  // 1. It is an Object.
  // 2. It is not a literal, set, or list (no @value, @set, or @list).
  // 3. It has more than 1 key OR any existing key is not '@id'.
  if(_isObject(value) &&
    !(('@value' in value) || ('@set' in value) || ('@list' in value))) {
    var keyCount = Object.keys(value).length;
    rval = (keyCount > 1 || !('@id' in value));
  }

  return rval;
}

/**
 * Returns true if the given value is a @set.
 *
 * @param value the value to check.
 *
 * @return true if the value is a @set, false if not.
 */
function _isSetValue(value) {
  var rval = false;

  // Note: A value is a @set if all of these hold true:
  // 1. It is an Object.
  // 2. It has the @set property.
  if(_isObject(value) && ('@set' in value)) {
    rval = true;
  }

  return rval;
}

/**
 * Returns true if the given value is a @list.
 *
 * @param value the value to check.
 *
 * @return true if the value is a @list, false if not.
 */
function _isListValue(value) {
  var rval = false;

  // Note: A value is a @list if all of these hold true:
  // 1. It is an Object.
  // 2. It has the @list property.
  if(_isObject(value) && ('@list' in value)) {
    rval = true;
  }

  return rval;
}

/**
 * Returns true if the given value is an absolute IRI, false if not.
 *
 * @param value the value to check.
 *
 * @return true if the value is an absolute IRI, false if not.
 */
function _isAbsoluteIri(value) {
  var regex = /(\w+):\/\/(.+)/;
  return regex.test(value);
}

/**
 * Clones an object, array, or string/number. If cloning an object, the keys
 * will be sorted.
 *
 * @param value the value to clone.
 *
 * @return the cloned value.
 */
function _clone(value) {
  var rval;

  if(_isObject(value)) {
    rval = {};
    var keys = Object.keys(value).sort();
    for(var i in keys) {
      var key = keys[i];
      rval[key] = _clone(value[key]);
    }
  }
  else if(_isArray(value)) {
    rval = [];
    for(var i in value) {
      rval[i] = _clone(value[i]);
    }
  }
  else {
    rval = value;
  }

  return rval;
}

/**
 * Optimizes a context. The output context will only contain entries that
 * are used in the given input.
 *
 * @param input the JSON-LD input object.
 * @param ctx the context to optimize.
 * @param rval the optimized context.
 *
 * @return the optimized context.
 */
function _optimizeContext(input, ctx, rval) {
  rval = rval || {};

  // FIXME: implement me
  /*if(_isArray(input)) {
    for(var i in input) {
      //_optimizeContext(input
    }
  }*/
  rval = ctx;

  return rval;
}

/**
 * Resolves external @context URLs using the given URL resolver. Each instance
 * of @context in the input that refers to a URL will be replaced with the
 * JSON @context found at that URL.
 *
 * @param input the JSON-LD object with possible contexts.
 * @param resolver(url, callback(err, jsonCtx)) the URL resolver to use.
 * @param callback(err, input) called once the operation completes.
 */
function _resolveUrls(input, resolver, callback) {
  // keeps track of resolved URLs (prevents duplicate work)
  var urls = {};

  // finds URLs in @context properties and replaces them with their
  // resolved @contexts if replace is true
  var findUrls = function(input, replace) {
    if(_isArray(input)) {
      for(var i in input) {
        findUrls(input[i], replace);
      }
    }
    else if(_isObject(input)) {
      for(var key in input) {
        if(key !== '@context') {
          continue;
        }

        // get @context
        var ctx = input[key];

        // array @context
        if(_isArray(ctx)) {
          for(var i in ctx) {
            if(_isString(ctx[i])) {
              // replace w/resolved @context if requested
              if(replace) {
                ctx[i] = urls[ctx[i]];
              }
              // unresolved @context found
              else {
                urls[ctx[i]] = {};
              }
            }
          }
        }
        // string @context
        else if(_isString(ctx)) {
          // replace w/resolved @context if requested
          if(replace) {
            input[key] = urls[ctx];
          }
          // unresolved @context found
          else {
            urls[ctx] = {};
          }
        }
      }
    }
  };
  findUrls(input, false);

  // state for resolving URLs
  var count = Object.keys(urls).length;
  var errors = [];

  // called once finished resolving URLs
  var finished = function() {
    if(errors.length > 0) {
      callback(new JsonLdError(
        'Could not resolve @context URL(s).',
        'jsonld.ContextUrlError',
        {errors: errors}));
    }
    else {
      callback(null, input);
    }
  };

  // nothing to resolve
  if(count === 0) {
    return finished();
  }

  // resolve all URLs
  for(var url in urls) {
    // validate URL
    var regex = /(http|https):\/\/(\w+:{0,1}\w*@)?(\S+)(:[0-9]+)?(\/|\/([\w#!:.?+=&%@!\-\/]))?/;
    if(!regex.test(url)) {
      count -= 1;
      errors.push(new JsonLdError(
        'Malformed URL.', 'jsonld.InvalidUrl', {url: url}));
      continue;
    }

    // resolve URL
    resolver(url, function(err, ctx) {
      count -= 1;

      // parse string context as JSON
      if(!err && _isString(ctx)) {
        try {
          ctx = JSON.parse(ctx);
        }
        catch(ex) {
          err = ex;
        }
      }

      // ensure ctx is an object
      if(!err && !_isObject(ctx)) {
        err = new JsonLdError(
          'URL does not resolve to a valid JSON-LD object.',
          'jsonld.InvalidUrl', {url: url});
      }

      if(err) {
        errors.push(err);
      }
      else {
        urls[url] = ctx['@context'] || {};
      }

      if(count === 0) {
        // if no errors, do URL replacement
        if(errors.length === 0) {
          findUrls(input, true);
        }
        finished();
      }
    });
  }
}

// define js 1.8.5 Object.keys method if not present
if(!Object.keys) {
  Object.keys = function(o) {
    if(o !== Object(o)) {
      throw new TypeError('Object.keys called on non-object');
    }
    var rval = [];
    for(var p in o) {
      if(Object.prototype.hasOwnProperty.call(o, p)) {
        rval.push(p);
      }
    }
    return rval;
  };
}

// SHA-1 API
var sha1 = jsonld.sha1 = {};

/**
 * Hashes the given string and returns its hexadecimal SHA-1 message digest.
 *
 * @param str the string to hash.
 *
 * @return the hexadecimal SHA-1 message digest.
 */
if(_nodejs) {
  sha1.hash = function(str) {
    var md = crypto.createHash('sha1');
    md.update(str, 'utf8');
    rval = md.digest('hex');
  };
}
else {
  sha1.hash = function(str) {
    var md = new sha1.MessageDigest();
    md.update(str);
    return md.digest();
  };
}

// only define sha1 MessageDigest for non-nodejs
if(!_nodejs) {

/**
 * Creates a simple byte buffer for message digest operations.
 */
sha1.Buffer = function() {
  this.data = '';
  this.read = 0;
};

/**
 * Puts a 32-bit integer into this buffer in big-endian order.
 *
 * @param i the 32-bit integer.
 */
sha1.Buffer.prototype.putInt32 = function(i) {
  this.data += (
    String.fromCharCode(i >> 24 & 0xFF) +
    String.fromCharCode(i >> 16 & 0xFF) +
    String.fromCharCode(i >> 8 & 0xFF) +
    String.fromCharCode(i & 0xFF));
};

/**
 * Gets a 32-bit integer from this buffer in big-endian order and
 * advances the read pointer by 4.
 *
 * @return the word.
 */
sha1.Buffer.prototype.getInt32 = function() {
  var rval = (
    this.data.charCodeAt(this.read) << 24 ^
    this.data.charCodeAt(this.read + 1) << 16 ^
    this.data.charCodeAt(this.read + 2) << 8 ^
    this.data.charCodeAt(this.read + 3));
  this.read += 4;
  return rval;
};

/**
 * Gets the bytes in this buffer.
 *
 * @return a string full of UTF-8 encoded characters.
 */
sha1.Buffer.prototype.bytes = function() {
  return this.data.slice(this.read);
};

/**
 * Gets the number of bytes in this buffer.
 *
 * @return the number of bytes in this buffer.
 */
sha1.Buffer.prototype.length = function() {
  return this.data.length - this.read;
};

/**
 * Compacts this buffer.
 */
sha1.Buffer.prototype.compact = function() {
  this.data = this.data.slice(this.read);
  this.read = 0;
};

/**
 * Converts this buffer to a hexadecimal string.
 *
 * @return a hexadecimal string.
 */
sha1.Buffer.prototype.toHex = function() {
  var rval = '';
  for(var i = this.read; i < this.data.length; ++i) {
    var b = this.data.charCodeAt(i);
    if(b < 16) {
      rval += '0';
    }
    rval += b.toString(16);
  }
  return rval;
};

/**
 * Creates a SHA-1 message digest object.
 *
 * @return a message digest object.
 */
sha1.MessageDigest = function() {
  // do initialization as necessary
  if(!_sha1.initialized) {
    _sha1.init();
  }

  this.blockLength = 64;
  this.digestLength = 20;
  // length of message so far (does not including padding)
  this.messageLength = 0;

  // input buffer
  this.input = new sha1.Buffer();

  // for storing words in the SHA-1 algorithm
  this.words = new Array(80);

  // SHA-1 state contains five 32-bit integers
  this.state = {
    h0: 0x67452301,
    h1: 0xEFCDAB89,
    h2: 0x98BADCFE,
    h3: 0x10325476,
    h4: 0xC3D2E1F0
  };
};

/**
 * Updates the digest with the given string input.
 *
 * @param msg the message input to update with.
 */
sha1.MessageDigest.prototype.update = function(msg) {
  // UTF-8 encode message
  msg = unescape(encodeURIComponent(msg));

  // update message length and input buffer
  this.messageLength += msg.length;
  this.input.data += msg;

  // process input
  _sha1.update(this.state, this.words, this.input);

  // compact input buffer every 2K or if empty
  if(this.input.read > 2048 || this.input.length() === 0) {
    this.input.compact();
  }
};

/**
 * Produces the digest.
 *
 * @return the digest as a hexadecimal string.
 */
sha1.MessageDigest.prototype.digest = function() {
  /* Determine the number of bytes that must be added to the message
  to ensure its length is congruent to 448 mod 512. In other words,
  a 64-bit integer that gives the length of the message will be
  appended to the message and whatever the length of the message is
  plus 64 bits must be a multiple of 512. So the length of the
  message must be congruent to 448 mod 512 because 512 - 64 = 448.

  In order to fill up the message length it must be filled with
  padding that begins with 1 bit followed by all 0 bits. Padding
  must *always* be present, so if the message length is already
  congruent to 448 mod 512, then 512 padding bits must be added. */

  // 512 bits == 64 bytes, 448 bits == 56 bytes, 64 bits = 8 bytes
  // _padding starts with 1 byte with first bit is set in it which
  // is byte value 128, then there may be up to 63 other pad bytes
  var len = this.messageLength;
  var padBytes = new sha1.Buffer();
  padBytes.data += this.input.bytes();
  padBytes.data += _sha1.padding.substr(0, 64 - ((len + 8) % 64));

  /* Now append length of the message. The length is appended in bits
  as a 64-bit number in big-endian order. Since we store the length
  in bytes, we must multiply it by 8 (or left shift by 3). So here
  store the high 3 bits in the low end of the first 32-bits of the
  64-bit number and the lower 5 bits in the high end of the second
  32-bits. */
  padBytes.putInt32((len >>> 29) & 0xFF);
  padBytes.putInt32((len << 3) & 0xFFFFFFFF);
  _sha1.update(this.state, this.words, padBytes);
  var rval = new sha1.Buffer();
  rval.putInt32(this.state.h0);
  rval.putInt32(this.state.h1);
  rval.putInt32(this.state.h2);
  rval.putInt32(this.state.h3);
  rval.putInt32(this.state.h4);
  return rval.toHex();
};

// private SHA-1 data
var _sha1 = {
  padding: null,
  initialized: false
};

/**
 * Initializes the constant tables.
 */
_sha1.init = function() {
  // create padding
  _sha1.padding = String.fromCharCode(128);
  var c = String.fromCharCode(0x00);
  var n = 64;
  while(n > 0) {
    if(n & 1) {
      _sha1.padding += c;
    }
    n >>>= 1;
    if(n > 0) {
      c += c;
    }
  }

  // now initialized
  _sha1.initialized = true;
};

/**
 * Updates a SHA-1 state with the given byte buffer.
 *
 * @param s the SHA-1 state to update.
 * @param w the array to use to store words.
 * @param input the input byte buffer.
 */
_sha1.update = function(s, w, input) {
  // consume 512 bit (64 byte) chunks
  var t, a, b, c, d, e, f, i;
  var len = input.length();
  while(len >= 64) {
    // the w array will be populated with sixteen 32-bit big-endian words
    // and then extended into 80 32-bit words according to SHA-1 algorithm
    // and for 32-79 using Max Locktyukhin's optimization

    // initialize hash value for this chunk
    a = s.h0;
    b = s.h1;
    c = s.h2;
    d = s.h3;
    e = s.h4;

    // round 1
    for(i = 0; i < 16; ++i) {
      t = input.getInt32();
      w[i] = t;
      f = d ^ (b & (c ^ d));
      t = ((a << 5) | (a >>> 27)) + f + e + 0x5A827999 + t;
      e = d;
      d = c;
      c = (b << 30) | (b >>> 2);
      b = a;
      a = t;
    }
    for(; i < 20; ++i) {
      t = (w[i - 3] ^ w[i - 8] ^ w[i - 14] ^ w[i - 16]);
      t = (t << 1) | (t >>> 31);
      w[i] = t;
      f = d ^ (b & (c ^ d));
      t = ((a << 5) | (a >>> 27)) + f + e + 0x5A827999 + t;
      e = d;
      d = c;
      c = (b << 30) | (b >>> 2);
      b = a;
      a = t;
    }
    // round 2
    for(; i < 32; ++i) {
      t = (w[i - 3] ^ w[i - 8] ^ w[i - 14] ^ w[i - 16]);
      t = (t << 1) | (t >>> 31);
      w[i] = t;
      f = b ^ c ^ d;
      t = ((a << 5) | (a >>> 27)) + f + e + 0x6ED9EBA1 + t;
      e = d;
      d = c;
      c = (b << 30) | (b >>> 2);
      b = a;
      a = t;
    }
    for(; i < 40; ++i) {
      t = (w[i - 6] ^ w[i - 16] ^ w[i - 28] ^ w[i - 32]);
      t = (t << 2) | (t >>> 30);
      w[i] = t;
      f = b ^ c ^ d;
      t = ((a << 5) | (a >>> 27)) + f + e + 0x6ED9EBA1 + t;
      e = d;
      d = c;
      c = (b << 30) | (b >>> 2);
      b = a;
      a = t;
    }
    // round 3
    for(; i < 60; ++i) {
      t = (w[i - 6] ^ w[i - 16] ^ w[i - 28] ^ w[i - 32]);
      t = (t << 2) | (t >>> 30);
      w[i] = t;
      f = (b & c) | (d & (b ^ c));
      t = ((a << 5) | (a >>> 27)) + f + e + 0x8F1BBCDC + t;
      e = d;
      d = c;
      c = (b << 30) | (b >>> 2);
      b = a;
      a = t;
    }
    // round 4
    for(; i < 80; ++i) {
      t = (w[i - 6] ^ w[i - 16] ^ w[i - 28] ^ w[i - 32]);
      t = (t << 2) | (t >>> 30);
      w[i] = t;
      f = b ^ c ^ d;
      t = ((a << 5) | (a >>> 27)) + f + e + 0xCA62C1D6 + t;
      e = d;
      d = c;
      c = (b << 30) | (b >>> 2);
      b = a;
      a = t;
    }

    // update hash state
    s.h0 += a;
    s.h1 += b;
    s.h2 += c;
    s.h3 += d;
    s.h4 += e;

    len -= 64;
  }
};

} // end non-nodejs

})();

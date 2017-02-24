import archiver   from 'archiver';
import fs         from 'fs-extra';
import glob       from 'glob';
import isGlob     from 'is-glob';
import path       from 'path';

/**
 * FileUtil - Provides several utility methods for archiving, copying, reading, and writing files.
 */
export default class FileUtil
{
   /**
    * Instantiate FileUtil.
    *
    * @param {FileUtilOptions}  options - FileUtilOptions to set.
    */
   constructor(options = {})
   {
      if (typeof options !== 'object') { throw new TypeError(`'options' is not an object.`); }

      /**
       * Stores FileUtil options.
       * @type {FileUtilOptions}
       * @private
       */
      this._options =
      {
         compressFormat: 'tar.gz',
         eventbus: null,
         lockRelative: false,
         logEvent: 'log:debug',
         relativePath: null
      };

      /**
       * Stores the stack of archiver instances.
       * @type {Array}
       */
      this.archiverStack = [];

      /**
       * Provides a unique counter for temporary archives.
       * @type {number}
       */
      this.archiveCntr = 0;

      this.setOptions(options);
   }

   /**
    * Create a compressed archive relative to the output destination. All subsequent file write and copy operations
    * will add to the existing archive. You must invoke `archiveFinalize` to complete the archive process.
    *
    * @param {string}   destPath - Destination path and file name; the compress format extension will be appended.
    *
    * @param {boolean}  [addToParent=true] - If a parent archiver exists then add child archive to it and delete local
    *                                        file.
    *
    * @param {boolean}  [silent=false] - When true `output: <destPath>` is logged.
    */
   archiveCreate(destPath, addToParent = true, silent = false)
   {
      if (typeof destPath !== 'string') { throw new TypeError(`'destPath' is not a 'string'.`); }
      if (typeof addToParent !== 'boolean') { throw new TypeError(`'addToParent' is not a 'boolean'.`); }
      if (typeof silent !== 'boolean') { throw new TypeError(`'silent' is not a 'boolean'.`); }

      if (typeof silent === 'boolean' && !silent) { s_LOG(this._options, `creating archive: ${destPath}`); }

      const compressFormat = this._options.compressFormat;

      // Add archive format to `destPath`.
      destPath = `${destPath}.${compressFormat}`;

      let resolvedDest = this._options.relativePath ? path.resolve(this._options.relativePath, destPath) :
       path.resolve(destPath);

      // If a child archive is being created, `addToParent` is false then change the resolved destination to a
      // temporary file so that the parent instance can add it before finalizing.
      if (this.archiverStack.length > 0 && addToParent)
      {
         const dirName = path.dirname(resolvedDest);

         resolvedDest = `${dirName}${path.sep}.temp-${this.archiveCntr++}`;
      }

      let archive;

      switch (compressFormat)
      {
         case 'tar.gz':
            archive = archiver('tar', { gzip: true, gzipOptions: { level: 9 } });
            break;

         case 'zip':
            archive = archiver('zip', { zlib: { level: 9 } });
            break;

         default:
            throw new Error(`Unknown compression format: '${compressFormat}'.`);
      }

      // Make sure the resolved destination is a valid directory; if not create it...
      fs.ensureDirSync(path.dirname(resolvedDest));

      const stream = fs.createWriteStream(resolvedDest);

      // Catch any archiver errors.
      archive.on('error', (err) => { throw err; });

      // Pipe archive data to the file.
      archive.pipe(stream);

      // Create an archive instance holding relevant data for tracking children archives.
      const instance =
      {
         archive,
         destPath,
         resolvedDest,
         stream,
         addToParent,
         childPromises: []
      };

      this.archiverStack.push(instance);
   }

   /**
    * Finalizes an active archive. You must first invoke `archiveCreate`.
    *
    * @param {boolean}  [silent=false] - When true `output: <destPath>` is logged.
    *
    * @returns {Promise} - A resolved promise is returned which is triggered once archive finalization completes.
    */
   archiveFinalize(silent = false)
   {
      if (typeof silent !== 'boolean') { throw new TypeError(`'silent' is not a 'boolean'.`); }

      const instance = this._popArchive();

      if (instance !== null)
      {
         const parentInstance = this._getArchive();

         // If `addToParent` is true and there is a parent instance then push a new Promise into the parents
         // `childPromises` array and add callbacks to the current instances file stream to resolve the Promise.
         if (instance.addToParent && parentInstance !== null)
         {
            parentInstance.childPromises.push(new Promise((resolve, reject) =>
            {
               // Add event callbacks to instance stream such that on close the Promise is resolved.
               instance.stream.on('close', () =>
               {
                  resolve({ resolvedDest: instance.resolvedDest, destPath: instance.destPath });
               });

               // Any errors will reject the promise.
               instance.stream.on('error', reject);
            }));
         }

         if (typeof silent === 'boolean' && !silent)
         {
            s_LOG(this._options, `finalizing archive: ${instance.destPath}`);
         }

         // Resolve any child promises before finalizing current instance.
         return Promise.all(instance.childPromises).then((results) =>
         {
            // There are temporary child archives to insert into the current instance.
            for (const result of results)
            {
               // Append temporary archive to requested relative destPath.
               instance.archive.append(fs.createReadStream(result.resolvedDest), { name: result.destPath });

               // Remove temporary archive.
               fs.removeSync(result.resolvedDest);
            }

            // finalize the archive (ie we are done appending files but streams have to finish yet)
            instance.archive.finalize();
         });
      }
      else
      {
         s_LOG(this._options, `No active archive to finalize.`);
      }

      return Promise.resolve();
   }

   /**
    * Empties the resolved relative directory if one is set and it is different from the current working directory.
    */
   emptyRelativePath()
   {
      if (this._options.relativePath)
      {
         const resolvedPath = path.resolve(this._options.relativePath);

         // Do not empty path if resolvedPath is at or below the current working directory.
         if (process.cwd().startsWith(resolvedPath))
         {
            s_LOG(this._options, `FileUtil.emptyRelativePath: aborting as current working directory will be deleted.`);
         }
         else
         {
            s_LOG(this._options, `emptying: ${this._options.relativePath}`);

            fs.emptyDirSync(path.resolve(this._options.relativePath));
         }
      }
      else
      {
         s_LOG(this._options, 'FileUtil.emptyRelativePath: no relative path to empty.');
      }
   }

   /**
    * Finds the common base path of a collection of paths.
    *
    * @param {string[]} paths - Paths to find a common base path.
    *
    * @returns {string}
    */
   commonPath(...paths)
   {
      let commonPath = '';

      const folders = [];

      for (let i = 0; i < paths.length; i++)
      {
         folders.push(paths[i].split('/'));        // Split on file separator.
      }

      for (let j = 0; j < folders[0].length; j++)
      {
         const thisFolder = folders[0][j];         // Assign the next folder name in the first path.
         let allMatched = true;                    // Assume all have matched in case there are no more paths.

         for (let i = 1; i < folders.length && allMatched; i++)   // Look at the other paths.
         {
            if (folders[i].length < j)             // If there is no folder here.
            {
               allMatched = false;                 // No match.
               break;                              // Reached end of folders.
            }

            allMatched &= folders[i][j] === thisFolder; // Check if it matched.
         }

         if (allMatched)                           // If they all matched this folder name.
         {
            commonPath += `${thisFolder}/`;        // Add it to the common path.
         }
         else
         {
            break;                                 // Stop looking
         }
      }

      return commonPath;
   }

   /**
    * Finds the common base path of a collection of paths.
    *
    * @param {string}   key - A key to index into each object.
    *
    * @param {object[]} objects - Objects containing a key to holding a path.
    *
    * @returns {string}
    */
   commonMappedPath(key, ...objects)
   {
      let commonPath = '';

      const folders = [];

      for (let i = 0; i < objects.length; i++)
      {
         if (typeof objects[i][key] === 'string')
         {
            folders.push(objects[i][key].split('/')); // Split on file separator.
         }
      }

      for (let j = 0; j < folders[0].length; j++)
      {
         const thisFolder = folders[0][j];         // Assign the next folder name in the first path.
         let allMatched = true;                    // Assume all have matched in case there are no more paths.

         for (let i = 1; i < folders.length && allMatched; i++)   // Look at the other paths.
         {
            if (folders[i].length < j)             // If there is no folder here.
            {
               allMatched = false;                 // No match.
               break;                              // Reached end of folders.
            }

            allMatched &= folders[i][j] === thisFolder; // Check if it matched.
         }

         if (allMatched)                           // If they all matched this folder name.
         {
            commonPath += `${thisFolder}/`;        // Add it to the common path.
         }
         else
         {
            break;                                 // Stop looking
         }
      }

      return commonPath;
   }

   /**
    * Copy a source path / to destination path or relative path.
    *
    * @param {string}   srcPath - Source path.
    *
    * @param {string}   destPath - Destination path.
    *
    * @param {boolean}  [silent=false] - When true `output: <destPath>` is logged.
    */
   copy(srcPath, destPath, silent = false)
   {
      if (typeof srcPath !== 'string') { throw new TypeError(`'srcPath' is not a 'string'.`); }
      if (typeof destPath !== 'string') { throw new TypeError(`'destPath' is not a 'string'.`); }
      if (typeof silent !== 'boolean') { throw new TypeError(`'silent' is not a 'boolean'.`); }

      if (typeof silent === 'boolean' && !silent) { s_LOG(this._options, `output: ${destPath}`); }

      const instance = this._getArchive();

      if (instance !== null)
      {
         if (fs.statSync(srcPath).isDirectory())
         {
            instance.archive.directory(srcPath, destPath);
         }
         else
         {
            instance.archive.file(srcPath, { name: destPath });
         }
      }
      else
      {
         fs.copySync(srcPath, this._options.relativePath ? path.resolve(this._options.relativePath, destPath) :
          path.resolve(destPath));
      }
   }

   /**
    * Gets the current archiver instance.
    *
    * @returns {*}
    */
   _getArchive()
   {
      return this.archiverStack.length > 0 ? this.archiverStack[this.archiverStack.length - 1] : null;
   }

   /**
    * Returns a copy of the FileUtil options.
    *
    * @returns {FileUtilOptions} - FileUtil options.
    */
   getOptions()
   {
      return JSON.parse(JSON.stringify(this._options));
   }

   /**
    * Hydrates a list of files finally defined as globs. Bare directory paths will be converted to globs.
    *
    * @param {string|Array<string>} globs - A string or array of strings defining file globs. Any entry which is not
    *                                       a glob will be converted to an all inclusive glob.
    *
    * @returns {{files: Array<string>, globs: Array<string>}}
    */
   hydrateGlob(globs)
   {
      if (!Array.isArray(globs) && typeof globs !== 'string')
      {
         throw new TypeError(`'globs' is not a 'string' or an 'array'.`);
      }

      // If not an array then convert globEntry to an array.
      const globArray = Array.isArray(globs) ? globs : [globs];

      // Verify that all entries are strings.
      for (let cntr = 0; cntr < globArray.length; cntr++)
      {
         if (typeof globArray[cntr] !== 'string')
         {
            throw new TypeError(`'globs[${cntr}]: '${globArray[cntr]}' is not a 'string'.`);
         }
      }

      const actualGlobs = [];

      // Process glob array and if any entry is not a glob then convert it to an all inclusive glob.
      let files = [].concat(...globArray.map((entry) =>
      {
         // Convert raw file path to glob as necessary.
         if (!isGlob(entry))
         {
            // Determine if any included trailing path separator is included.
            const results = (/([\\/])$/).exec(entry);
            const pathSep = results !== null ? results[0] : path.sep;

            // Build all inclusive glob based on bare path and covert it into an array containing it.
            entry = entry.endsWith(pathSep) ? `${entry}**${pathSep}*` : `${entry}${pathSep}**${pathSep}*`;
         }

         // Store all glob entries to catch any ones converted to globs above.
         actualGlobs.push(entry);

         return glob.sync(path.resolve(entry));
      }));

      // Filter out non-files; IE directories
      files = files.filter((file) => fs.statSync(file).isFile());

      return { files, globs: actualGlobs };
   }

   /**
    * Adds event bindings for FileUtil via `typhonjs-plugin-manager`.
    *
    * @param {PluginEvent} ev - A plugin event.
    */
   onPluginLoad(ev)
   {
      const eventbus = ev.eventbus;

      this._options.eventbus = eventbus;

      let eventPrepend = 'typhonjs:';

      const options = ev.pluginOptions;

      // Apply any plugin options.
      if (typeof options === 'object')
      {
         this.setOptions(options);

         // If `eventPrepend` is defined then it is prepended before all event bindings.
         if (typeof options.eventPrepend === 'string') { eventPrepend = `${options.eventPrepend}:`; }
      }

      eventbus.on(`${eventPrepend}util:file:archive:create`, this.archiveCreate, this);

      eventbus.on(`${eventPrepend}util:file:archive:finalize`, this.archiveFinalize, this);

      eventbus.on(`${eventPrepend}util:file:common:path`, this.commonPath, this);

      eventbus.on(`${eventPrepend}util:file:common:mapped:path`, this.commonMappedPath, this);

      eventbus.on(`${eventPrepend}util:file:copy`, this.copy, this);

      eventbus.on(`${eventPrepend}util:file:empty:relative:path`, this.emptyRelativePath, this);

      eventbus.on(`${eventPrepend}util:file:get:options`, this.getOptions, this);

      eventbus.on(`${eventPrepend}util:file:hydrate:glob`, this.hydrateGlob, this);

      eventbus.on(`${eventPrepend}util:file:read:lines`, this.readLines, this);

      eventbus.on(`${eventPrepend}util:file:set:options`, this.setOptions, this);

      eventbus.on(`${eventPrepend}util:file:write`, this.writeFile, this);
   }

   /**
    * Pops an archiver instance off the stack.
    *
    * @returns {*}
    */
   _popArchive()
   {
      return this.archiverStack.length > 0 ? this.archiverStack.pop() : null;
   }

   /**
    * Read lines from a file given a start and end line number.
    *
    * @param {string}   filePath - The file path to load.
    *
    * @param {number}   lineStart - The start line
    *
    * @param {number}   lineEnd - The end line
    *
    * @returns {String[]}
    */
   readLines(filePath, lineStart, lineEnd)
   {
      if (typeof filePath !== 'string') { throw new TypeError(`'filePath' is not a 'string'.`); }
      if (typeof lineStart !== 'number') { throw new TypeError(`'lineStart' is not a 'number'.`); }
      if (typeof lineEnd !== 'number') { throw new TypeError(`'lineEnd' is not a 'number'.`); }

      const lines = fs.readFileSync(filePath).toString().split('\n');
      const targetLines = [];

      if (lineStart < 0) { lineStart = 0; }
      if (lineEnd > lines.length) { lineEnd = lines.length; }

      for (let cntr = lineStart; cntr < lineEnd; cntr++)
      {
         targetLines.push(`${cntr + 1}| ${lines[cntr]}`);
      }

      return targetLines;
   }

   /**
    * Set optional parameters.
    *
    * @param {FileUtilOptions} options - Defines optional parameters to set.
    */
   setOptions(options = {})
   {
      if (typeof options !== 'object') { throw new TypeError(`'options' is not an 'object'.`); }

      if (!this._options.lockRelative && typeof options.relativePath === 'string')
      {
         this._options.relativePath = options.relativePath;
      }

      // Only set `lockRelative` if it already has not been set to true.
      if (!this._options.lockRelative && typeof options.lockRelative === 'boolean')
      {
         this._options.lockRelative = options.lockRelative;
      }

      if (typeof options.compressFormat === 'string') { this._options.compressFormat = options.compressFormat; }
      if (typeof options.eventbus === 'object') { this._options.eventbus = options.eventbus; }
      if (typeof options.logEvent === 'string') { this._options.logEvent = options.logEvent; }
   }

   /**
    * Write a file to file path or relative path.
    *
    * @param {object}   fileData - The file data.
    *
    * @param {string}   filePath - A relative file path and name to `config.destination`.
    *
    * @param {boolean}  [silent=false] - When true `output: <destPath>` is logged.
    *
    * @param {string}   [encoding=utf8] - The encoding type.
    */
   writeFile(fileData, filePath, silent = false, encoding = 'utf8')
   {
      if (typeof filePath !== 'string') { throw new TypeError(`'filePath' is not a 'string'.`); }
      if (typeof silent !== 'boolean') { throw new TypeError(`'silent' is not a 'boolean'.`); }
      if (typeof encoding !== 'string') { throw new TypeError(`'encoding' is not a 'string'.`); }
      if (typeof fileData === 'undefined' || fileData === null)
      {
         throw new TypeError(`'filePath' is not a 'string'.`);
      }

      if (typeof silent === 'boolean' && !silent) { s_LOG(this._options, `output: ${filePath}`); }

      const instance = this._getArchive();

      if (instance !== null)
      {
         instance.archive.append(fileData, { name: filePath });
      }
      else
      {
         // If this._options.relativePath is defined then resolve the relative path against filePath.
         fs.outputFileSync(this._options.relativePath ? path.resolve(this._options.relativePath, filePath) : filePath,
          fileData, { encoding });
      }
   }
}

/**
 * Creates an instance of FileUtil and assigns several methods to the plugin eventbus.
 *
 * @param {PluginEvent}    ev - A plugin event.
 *
 * @ignore
 */
export function onPluginLoad(ev)
{
   new FileUtil().onPluginLoad(ev);
}

// Module private ---------------------------------------------------------------------------------------------------

/**
 * Helper method to log a message over an eventbus if one is defined.
 *
 * @param {FileUtilOptions}   options - FileUtil options.
 *
 * @param {*}                 message - A message to log.
 *
 * @ignore
 */
const s_LOG = (options, message) =>
{
   if (options.eventbus && options.logEvent) { options.eventbus.trigger(options.logEvent, message); }
};

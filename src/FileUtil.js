import archiver   from 'archiver';
import fs         from 'fs-extra';
import glob       from 'glob';
import isGlob     from 'is-glob';
import path       from 'path';

/**
 * FileUtil
 */
export default class FileUtil
{
   /**
    * Instantiate FileUtil
    *
    * @param {FileUtilOptions}  options -
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
         logEvent: 'log:info:raw',
         relativePath: null
      };

      /**
       *
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
    * Helper event binding to create a compressed archive relative to the output destination. All subsequent file
    * write and copy operations will add to the existing archive. You must invoke 'typhonjs:util:file:archive:finalize' to
    * complete the archive process.
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
      if (typeof silent === 'boolean' && !silent) { s_LOG(this._options, `creating archive: ${destPath}`); }

      const compressFormat = this._options.compressFormat;

      // Add archive format to `destPath`.
      destPath = `${destPath}.${compressFormat}`;

      let resolvedDest = this._options.relativePath ? path.resolve(this._options.relativePath, destPath) :
       path.resolve(destPath);

      // If a child archive is being created, `addToParent` is true and `config.separateDataFiles` is false then
      // change the resolved destination to a temporary file so that the parent instance can add it before finalizing.
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
    * Helper event binding to finalize an active archive. You must first invoke 'typhonjs:util:file:archive:create'.
    *
    * @param {boolean}  [silent=false] - When true `output: <destPath>` is logged.
    */
   archiveFinalize(silent = false)
   {
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
         Promise.all(instance.childPromises).then((results) =>
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
   }

   /**
    * Helper event binding to copy a source path / file relative to the output destination.
    *
    * @param {string}   srcPath - Source path.
    * @param {string}   destPath - Destination path.
    * @param {boolean}  [silent=false] - When true `output: <destPath>` is logged.
    */
   copy(srcPath, destPath, silent = false)
   {
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
    * Looks up a glob or bare path entry in `config` via `globEntry` then hydrates a list of files finally
    * storing any generated modification back to the accessor entries.
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
    * Adds event bindings for FileUtil.
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

      eventbus.on(`${eventPrepend}util:file:hydrate:glob`, this.hydrateGlob, this);

      eventbus.on(`${eventPrepend}util:file:archive:create`, this.archiveCreate, this);

      eventbus.on(`${eventPrepend}util:file:archive:finalize`, this.archiveFinalize, this);

      eventbus.on(`${eventPrepend}util:file:copy`, this.copy, this);

      eventbus.on(`${eventPrepend}util:file:get:options`, this.getOptions, this);

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
    * Helper event binding to read lines from a file given a start and end line number.
    *
    * @param {string}   filePath - The file path to load.
    * @param {number}   lineStart - The start line
    * @param {number}   lineEnd - The end line
    * @returns {String[]}
    */
   readLines(filePath, lineStart, lineEnd)
   {
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
    * Helper event binding to output a file relative to the output destination.
    *
    * @param {object}   fileData - The file data.
    * @param {string}   fileName - A relative file path and name to `config.destination`.
    * @param {boolean}  [silent=false] - When true `output: <destPath>` is logged.
    * @param {encoding} [encoding=utf8] - The encoding type.
    */
   writeFile(fileData, fileName, silent = false, encoding = 'utf8')
   {
      if (typeof silent === 'boolean' && !silent) { s_LOG(this._options, `output: ${fileName}`); }

      const instance = this._getArchive();

      if (instance !== null)
      {
         instance.archive.append(fileData, { name: fileName });
      }
      else
      {
         // If this._options.relativePath is defined then resolve the relative path against fileName.
         fs.outputFileSync(this._options.relativePath ? path.resolve(this._options.relativePath, fileName) : fileName,
          fileData, { encoding });
      }
   }
}

/**
 * Creates an instance of FileUtil and assigns several methods to the plugin eventbus.
 *
 * @param {PluginEvent}    ev - A plugin event.
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
 * @param {*}                 message - A message to log.
 */
const s_LOG = (options, message) =>
{
   if (options.eventbus && options.logEvent) { options.eventbus.trigger(options.logEvent, message); }
};

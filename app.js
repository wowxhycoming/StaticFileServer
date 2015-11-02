/**
 * Created by xuhuaiyu on 2015/4/5. Version 0.1
 *  只支持get请求获取资源；只支持图片
 * Update by xuhuaiyu on 2015/8/8.  Version 0.2
 *  支持所有MIME类型，并没有对类型进行限制；HTTP协议支持（大）文件上传、下载；
 *
 * Next Version ：
 *  1.文件压缩
 *  2.探测当前访问，返回其支持的压缩类型
 *  3.缓存支持/控制
 *  4.考虑一下安全问题
 *  5.媒体断点支持（Range？），（看个电影、听个歌）
 */

var http = require("http");
var url = require("url");
var path = require('path');
var fs = require('fs');
var moment = require("moment");
var async = require('async');
var uuid = require('node-uuid');
var BufferHelper = require('bufferhelper');

var config = require('./config.js');
var mime = config.MIME;
var rootPath = config.Server.rootPath;
var secretPath = config.Server.secretPath; // TODO 处理forbidden area
var errCode = config.ErrCode;
var unknown = "unknown";

// 创建服务
var server = http.createServer(listener);

// 监听
function listener(request,response) {

    // 未处理的异常截获
    process.setMaxListeners(30);
    holdUncaughtException(process, response);

    var pathName = url.parse(request.url).pathname; // http://ip:port/pathname[?a=1&b=2]
    console.log("pathName= " + pathName);
    // 禁止 访问根目录 和 访问上级目录
    var realPath = path.join(rootPath, path.normalize(pathName.replace(/\.\./g, "")));
    var originalExt = path.extname(realPath); // .*
    // 必须是允许的文件的文件
    var realExt = originalExt ? originalExt.slice(1) : unknown; // 去掉.
    var contentType = mime[realExt];
    // 找不到MIME，取默认
    if(!contentType) {
        contentType = mime[unknown];
    }
    console.log("contentType=" + contentType);

    // GET请求的全部视为获取资源
    if (request.method === 'GET'){
        console.log("get connection");
        fs.exists(realPath, function (exists) { // 检查文件是否存在
            console.log("开始检查文件");
            if (!exists) { // 文件或文件夹不存在
                console.log("文件或文件夹不存在=" + realPath);
                //returnClientErrorCode(response, 403);
            } else { // 文件或文件夹存在
                console.log("开始访问文件");
                async.series({
                    one : function(callback) {
                        console.log("检查文件状态");
                        fs.stat(realPath, function(err, stat){
                            console.log("check async 1");
                            if(err) {
                                console.log("检查文件出错=" + err);
                                callback(errCode.e101, err);
                            } else {
                                console.log("检查get路径是文件夹还是文件");
                                //console.log(stat.isDirectory());
                                if (stat.isDirectory()) {
                                    console.log("对文件夹进行访问=" + realPath);
                                    callback(errCode.e102); // 如果是文件夹，不想理你
                                } else {
                                    // 继续执行
                                    callback(null);
                                }
                            }
                        });
                    },
                    two : function(callback) {
                        console.log("开始读取文件");
                        fs.readFile(realPath, "binary", function(err, file) {
                            if (err) {
                                console.log("读取文件失败=" + err);
                                callback(errCode.e101, err);
                            } else {
                                console.log("读取文件成功=" + realPath);
                                callback(null, file);
                            }
                        });
                    }
                },function(err, results){
                    if(err) {
                        // 返回异常的HTTP返回码
                        console.log("GET  HttpRetuenCode=" + err);
                        returnClientErrorCode(response, err);
                    } else {
                        // 返回文件
                        //console.log("GET  success=" + results.two);
                        response.writeHead(200, {'Content-Type': contentType});
                        response.write(results.two, 'binary');
                        response.end();
                    }
                });
            }
        });

    } else if (request.method === 'POST'){ // POST请求全部视为文件上传

        var httpPathLevels = pathName.split("/");
        var httpPathLevelCount = httpPathLevels.length ;

        var currentPath; // 文件路径
        var fileName; // 文件名
        var bufferHelper = new BufferHelper();

        if(httpPathLevelCount == 3
            && httpPathLevels[1]==='upload' // 规则为，根目录后第一个路径为upload
            && httpPathLevels[2].indexOf(".") != -1) {

            currentPath = path.join(rootPath, moment().format("YYYYMMDD"));
            fileName = uuid.v1() + originalExt;

            //console.log(currentPath);
            //console.log(fileName);

            var fileData;
            // 响应输入数据
            request.on('data', function (chunk) {
                /*
                 fileData += chunk;
                 如果这个文件读取流读取的是一个纯英文的文件，这段代码是能够正常输出的。
                 但是如果我们再改变一下条件，将每次读取的buffer大小变成一个奇数，以模拟一个字符被分配在两个trunk中的场景。
                 这样就会出现乱码。
                 data实现应该像下面 注释1 一样
                 */

                bufferHelper.concat(chunk);
            });

            /* 注释1
            var buffers = [];
            var nread = 0;
            readStream.on('data', function (chunk) {
                buffers.push(chunk);
                nread += chunk.length;
            });
            readStream.on('end', function () {
                var buffer = null;
                switch(buffers.length) {
                    case 0: buffer = new Buffer(0);
                        break;
                    case 1: buffer = buffers[0];
                        break;
                    default:
                        buffer = new Buffer(nread);
                        for (var i = 0, pos = 0, l = buffers.length; i < l; i++) {
                            var chunk = buffers[i];
                            chunk.copy(buffer, pos);
                            pos += chunk.length;
                        }
                        break;
                }
            });
            */

            request.on('end', function() {
                async.series({
                    // 创建不存在的文件夹
                    one : function(callback) {
                        mkdirs(currentPath, 0777, function (err, dirpath) {
                            callback(err, dirpath);
                        });
                    },
                    // 写文件
                    two : function(callback) {
                        var fullFileName = path.join(currentPath,fileName);
                        fs.writeFile(fullFileName, new Buffer(bufferHelper.toBuffer(), 'binary'), function (err) {
                            callback(err, fullFileName);
                        });
                    }
                },function(err,result){
                    //console.log(err);
                    console.log(result);
                    if(err) {
                        returnClientErrorCode(response, 500);
                    } else {
                        var returnFilePath = result.two;
                        returnFilePath = returnFilePath.substring(returnFilePath.indexOf(path.sep));
                        //console.log(returnFilePath);
                        response.writeHead(200, {'Content-Type': ''});
                        response.end(returnFilePath);
                    }
                });
            });

        } else {
            returnClientErrorCode(response, 403);
        }
    } else { // 其他方式的请求全部是不允许的
        // Forbidden
        response.writeHead(403);
        response.end();
    }
}

// 启动
server.listen(config.Server.port);

function holdUncaughtException(process, response) {

    process.on('uncaughtException', function (err) {
        //打印出错误
        console.log(err);
        //打印出错误的调用栈方便调试
        console.log(err.stack);

        process.removeAllListeners('uncaughtException');

        returnClientErrorCode(response, 500);
    });
}

/**
 * 异步递归创建多层文件夹
 * @param dirpath
 * @param mode
 * @param callback(err, dirpath)  接收两个参数，错误信息和最终创建的路径
 */
function mkdirs(dirpath, mode, callback) {
    fs.exists(dirpath, function(exists) {
        if(exists) {
            callback(undefined,dirpath);
        } else {
            //尝试创建父目录，然后再创建当前目录
            mkdirs(path.dirname(dirpath), mode, function(){
                fs.mkdir(dirpath, mode, function(err){
                    if(err) {
                        callback(err, undefined);
                    } else {
                        callback(undefined, dirpath);
                    }
                });
            });
        }
    });
}

function returnClientErrorCode(response, code) {
    response.writeHead(code);
    response.end();
}
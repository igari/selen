"use strict";

const fs = require('fs');
const gm = require('gm');
const rimraf = require('rimraf');
const util = require('./util.js');
const PATH = {
  TEMP_DIR: './.temp/',
  TEMP_FILENAME: 'temp_h{h}_v{v}.png',
  TEMP_HCOMB_FILENAME: 'temp_hcomb_v{v}.png'
};

function Capture(selenium) {
  this.driver = selenium.driver;
  this.imagePathList = [];
  this.func2str = selenium.func2str;
  this.executeScript = selenium.executeScript;
  this.capabilities = selenium.capabilities;
}

Capture.prototype = {

  takeScreenshot: function (absoluteImageFilePath) {
    return this.driver.takeScreenshot()
      .then(function (photoData) {
        return util.makeDir(absoluteImageFilePath).then(function () {
          fs.writeFileSync(absoluteImageFilePath, photoData, 'base64');
          this.imagePathList.push(absoluteImageFilePath);
          console.log('[saved]', `${absoluteImageFilePath} (takeScreenshot)`);
        }.bind(this));
      }.bind(this));
  },
  takeFullScreenshot: function (absoluteImageFilePath) {

    return this.executeScript(function () {
      return window.devicePixelRatio;
    })
      .then(function (devicePixelRatio) {
        this.devicePixelRatio = +devicePixelRatio;
      }.bind(this))
      .then(this.deleteTempImages.bind(this))
      .then(this.executeScript.bind(this, this.fixed2absoluteInBrowser))
      .then(this.captureFullPage.bind(this))
      .then(this.combineTempImages.bind(this, absoluteImageFilePath))
      .then(this.deleteTempImages.bind(this))
      .then(function () {
        console.log('[saved]', `${absoluteImageFilePath} (takeScreenshot)`);
      });
  },

  getPageInformation: function (page) {
    return Promise.all([
      this.executeScript(function () {
        return document.documentElement.scrollHeight || document.body.scrollHeight;
      }),
      this.executeScript(function () {
        return document.documentElement.scrollWidth || document.body.scrollWidth;
      }),
      this.executeScript(function () {
        return window.innerHeight;
      }),
      this.executeScript(function () {
        return window.innerWidth;
      }),
      this.executeScript(function () {
        return window.screen.height;
      }),
      this.executeScript(function () {
        return window.screen.availHeight;
      }),
    ])
      .then(function (dataArray) {

        page.scrollHeight = dataArray[0];
        page.scrollWidth = dataArray[1];
        page.windowHeight = this.capabilities.os === 'ios' ? dataArray[2] - 5 : dataArray[2];
        page.windowWidth = dataArray[3];
        page.screenHeight = dataArray[4];
        page.screenAvailHeight = dataArray[5];

        console.log('[page.scrollWidth]', page.scrollWidth);
        console.log('[page.screenHeight]', page.screenHeight);
        console.log('[page.windowWidth]', page.windowWidth);
        console.log('[page.windowHeight]', page.windowHeight);
        console.log('[page.screenHeight]', page.screenHeight);
        console.log('[page.screenAvailHeight]', page.screenAvailHeight);

        return page;
      }.bind(this));
  },

  showProgressOfCapture: function (page) {
    let currentScreenshotWidth = page.windowWidth * (page.hScrollIndex + 1);
    let currentScreenshotHeight = page.windowHeight * (page.vScrollIndex + 1);
    let rateOfHorizontalScreenshot = `${Math.round(currentScreenshotWidth / page.scrollWidth * 100)}%`;
    let rateOfVerticalScreenshot = `${Math.round(currentScreenshotHeight / page.scrollHeight * 100)}%`;
    console.log('[rate of horizontal screenshot]', `${rateOfHorizontalScreenshot} (${currentScreenshotWidth}/${page.scrollWidth})`);
    console.log('[rate of vertical screenshot]', `${rateOfVerticalScreenshot} (${currentScreenshotHeight}/${page.scrollHeight})`);
    return page;
  },

  showProgressOfScrolling: function () {
    return this.executeScript(function () {
      return window.scrollY || window.pageYOffset;
    })
      .then(function (pageYOffset) {
        console.log('[pageYOffset]', pageYOffset);
      });
  },

  captureFullPage: function () {

    return new Promise(function (resolve) {

      let page = {
        vScrollIndex: 0,
        hScrollIndex: 0
      };

      let capturePage = function () {

        this.getPageInformation(page)
          .then(this.showProgressOfCapture.bind(null))
          .then(this.scrollAndSaveScreenshot.bind(this))
          .then(this.onScrollEnd.bind(this, page, capturePage))
          .then(function (isAllScrollDone) {
            if (isAllScrollDone) {
              resolve();
            } else {
              capturePage();
            }
          })
      }.bind(this);

      capturePage();

    }.bind(this));
  },

  onScrollEnd: function (page) {

    let hScrollMaxCount = Math.ceil(page.scrollWidth / page.windowWidth);
    let vScrollMaxCount = Math.ceil(page.scrollHeight / page.windowHeight);

    let isLastHScroll = page.hScrollIndex === hScrollMaxCount - 1;
    let isLastVScroll = page.vScrollIndex === vScrollMaxCount - 1;
    let isAllScrollDone = isLastHScroll && isLastVScroll;

    if (!isAllScrollDone) {
      if (isLastHScroll) {
        page.hScrollIndex = 0;
        page.vScrollIndex++;
      } else {
        page.hScrollIndex++;
      }
    }

    console.log(`[isAllScrollDone]: ${isAllScrollDone}`);

    return isAllScrollDone;
  },

  scrollAndSaveScreenshot: function (page) {

    let pathName = PATH.TEMP_DIR + PATH.TEMP_FILENAME.replace('{h}', page.hScrollIndex + '').replace('{v}', page.vScrollIndex + '');

    let currentScrollPosY = page.windowHeight * page.vScrollIndex;
    let currentScrollPosX = page.windowWidth * page.hScrollIndex;
    let currentCapturedWidth = currentScrollPosX + page.windowWidth;
    let currentCapturedHeight = currentScrollPosY + page.windowHeight;

    let extraWidth;
    let extraHeight;

    let isOverScrollOfHorizontal = page.scrollWidth < currentCapturedWidth;
    let isOverScrollOfVertical = page.scrollHeight < currentCapturedHeight;

    if (isOverScrollOfHorizontal) {
      extraWidth = page.scrollWidth - currentScrollPosX;
    }

    if (isOverScrollOfVertical) {
      extraHeight = page.scrollHeight - currentScrollPosY;
    }

    return this.scroll2NextPos(currentScrollPosX, currentScrollPosY)
      .then(this.driver.sleep.bind(this.driver, 1000))
      .then(this.getPageInformation.bind(this, page))
      .then(this.showProgressOfScrolling.bind(this))
      .then(this.takeScreenshot.bind(this, pathName))
      .then(this.cropHeaderFooterOfIPhone.bind(this, pathName, page))
      .then(this.cropOverflowOfHorizontal.bind(this, page, pathName, extraWidth))
      .then(this.cropOverflowOfVertical.bind(this, page, pathName, extraHeight))
      .then(function () {
        return page;
      });
  },
  scroll2NextPos: function (currentScrollPosX, currentScrollPosY) {
    return this.executeScript(function (currentScrollPosX, currentScrollPosY) {
      var __scroll__ = typeof window.scrollTo === 'function' ? window.scrollTo : window.scroll;
      __scroll__(currentScrollPosX, currentScrollPosY);
    }, currentScrollPosX, currentScrollPosY);
  },
  cropOverflowOfHorizontal: function (page, pathName, extraWidth) {
    if (extraWidth > 0) {
      return this.cropImage(pathName, extraWidth, page.windowHeight, page.windowWidth - extraWidth, 0);
    }
  },
  cropOverflowOfVertical: function (page, pathName, extraHeight) {
    if (extraHeight > 0) {
      return this.cropImage(pathName, page.windowWidth, extraHeight, 0, page.windowHeight - extraHeight);
    }
  },
  cropHeaderFooterOfIPhone: function (pathName, page) {
    if (this.capabilities.os === 'ios') {
      let screenHeaderHeight = 50;
      let screenFooterHeight = screenHeaderHeight + 40;
      let viewportHeight = page.windowHeight - screenHeaderHeight - screenFooterHeight;
      return this.cropImage(pathName, page.windowWidth, viewportHeight, 0, screenHeaderHeight);
    }
  },
  combineTempImages: function (absoluteImageFilePath) {

    return this.generateHashPathList()
      .then(this.combineHorizontalTempImages.bind(this))
      .then(this.combineVerticalTempImages.bind(this))
      .then(function (combineImage) {
        return this.saveCombineImage(absoluteImageFilePath, combineImage)
      }.bind(this));
  },
  generateHashPathList: function () {
    let hashPathList = this.imagePathList.reduce(function (previousValue, currentValue, index) {
      var hashV = parseInt(currentValue.match(/v[0-9]+/)[0].slice(1));
      if (previousValue[hashV] === undefined) {
        previousValue[hashV] = [];
      }
      previousValue[hashV].push(currentValue);
      return previousValue;
    }, {});
    return Promise.resolve(hashPathList);
  },
  combineVerticalTempImages: function (horizontalCombList) {
    return this.appendTempImages(horizontalCombList, false);
  },
  combineHorizontalTempImages: function (hashPathList) {

    return new Promise(function (resolve) {

      let horizontalCombList = [];
      let combineHorizontalTempImage = function (vScrollIndex) {

        let hasNextData = hashPathList[vScrollIndex] !== undefined;
        if (!hasNextData) {
          resolve(horizontalCombList);
          return;
        }

        let imageList = hashPathList[vScrollIndex];
        let templateFileName = PATH.TEMP_DIR + PATH.TEMP_HCOMB_FILENAME.replace('{v}', vScrollIndex);

        this.appendTempImages(imageList, true)
          .then(function (combineImage) {
            return this.saveCombineImage(templateFileName, combineImage);
          }.bind(this))
          .then(function () {
            horizontalCombList.push(templateFileName);
            combineHorizontalTempImage(++vScrollIndex);
          });

      }.bind(this);

      combineHorizontalTempImage(0);

    }.bind(this));
  },
  appendTempImages: function (imageList, isHorizontalCombine) {
    let combineImage = null;
    for (let image of imageList) {
      if (combineImage === null) {
        combineImage = gm(image);
      } else {
        combineImage.append(image, isHorizontalCombine);
      }
    }
    return Promise.resolve(combineImage);
  },
  saveCombineImage: function (fileName, combineImage) {

    if (!combineImage) {
      return Promise.resolve();
    }

    return util.makeDir(fileName)
      .then(function () {
        return this.writeCombineImage(fileName, combineImage);
      }.bind(this))
      .catch(function (err) {
        if (err) throw err;
      }.bind(this));
  },
  writeCombineImage: function (fileName, combineImage) {
    return new Promise(function (resolve, reject) {
      try {
        combineImage.write(fileName, function () {
          console.log('[combined]' + fileName);
          resolve();
        });
      } catch (e) {
        reject(e)
      }
    });
  },
  cropImage: function (fileName, width, height, x, y) {
    width = width * this.devicePixelRatio;
    height = height * this.devicePixelRatio;
    x = x * this.devicePixelRatio;
    y = y * this.devicePixelRatio;

    return new Promise(function (resolve, reject) {
      try {
        gm(fileName)
          .crop(width, height, x, y)
          .write(fileName, function () {
            console.log('[cropped]' + fileName);
            resolve();
          });
      } catch (e) {
        reject(e);
      }
    });
  },
  deleteTempImages: function () {
    return new Promise(function (resolve, reject) {
      rimraf(PATH.TEMP_DIR, resolve);
    });
  },

  fixed2absoluteInBrowser: function () {
    var style = document.querySelector('#capium-style-element');
    if (!style) {
      style = document.createElement('style');
      style.id = 'capium-style-element';
      var head = document.querySelector('head');
      head.appendChild(style);
    }

    var sheet = style.sheet;

    window.addEventListener('scroll', function () {
      var __scrollY__ = window.scrollY || window.pageYOffset;
      if (__scrollY__ > 200) {
        var allElements = document.querySelectorAll("*");
        for (var i = 0, len = allElements.length; i < len; i++) {
          var element = allElements[i];
          var position = getComputedStyle(element).position;
          if (position === 'fixed') {
            element.style.setProperty('visibility', 'hidden', 'important');
          }
          var positionBefore = getComputedStyle(element, '::before').position;
          var positionAfter = getComputedStyle(element, '::after').position;
          var className = element.className ? '.' + Array.prototype.join.call(element.classList, '.') : '';
          var idName = '#' + element.id;
          var tagName = element.tagName.toLowerCase();
          if (positionBefore === 'fixed') {
            sheet.insertRule(tagName + idName + className + '::before {visibility:hidden !important;}', sheet.cssRules.length - 1);
          }
          if (positionAfter === 'fixed') {
            sheet.insertRule(tagName + idName + className + '::after {visibility:hidden !important;}', sheet.cssRules.length - 1);
          }
        }
      }
    });
  },
};

module.exports = Capture;
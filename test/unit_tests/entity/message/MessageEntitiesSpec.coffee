#
# Wire
# Copyright (C) 2016 Wire Swiss GmbH
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.
#
# This program is distributed in the hope that it will be useful,
# but WITHOUT ANY WARRANTY; without even the implied warranty of
# MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
# GNU General Public License for more details.
#
# You should have received a copy of the GNU General Public License
# along with this program. If not, see http://www.gnu.org/licenses/.
#

# grunt test_init && grunt test_run:entity/message/MessageEntities

describe 'Message Entities', ->

  message_et = null

  describe 'ContentMessage', ->
    beforeEach ->
      message_et = new z.entity.ContentMessage()

    describe 'no asset', ->
      it 'has_asset_medium_image return false', ->
        expect(message_et.has_asset_medium_image()).toBeFalsy()

      it 'has_asset_preview_image return false', ->
        expect(message_et.has_asset_preview_image()).toBeFalsy()

      it 'has_asset_text return false', ->
        expect(message_et.has_asset_text()).toBeFalsy()

    describe 'medium asset', ->
      beforeEach ->
        message_et.assets.push new z.entity.MediumImage()

      it 'has_asset_medium_image return true', ->
        expect(message_et.has_asset_medium_image()).toBeTruthy()

      it 'has_asset_preview_image return false', ->
        expect(message_et.has_asset_preview_image()).toBeFalsy()

      it 'has_asset_text return false', ->
        expect(message_et.has_asset_text()).toBeFalsy()

    describe 'preview asset', ->
      beforeEach ->
        message_et.assets.push new z.entity.PreviewImage()

      it 'has_asset_medium_image return false', ->
        expect(message_et.has_asset_medium_image()).toBeFalsy()

      it 'has_asset_preview_image return true', ->
        expect(message_et.has_asset_preview_image()).toBeTruthy()

      it 'has_asset_text return false', ->
        expect(message_et.has_asset_text()).toBeFalsy()

    describe 'text asset', ->
      beforeEach ->
        message_et.assets.push new z.entity.Text()

      it 'has_asset_medium_image return false', ->
        expect(message_et.has_asset_medium_image()).toBeFalsy()

      it 'has_asset_preview_image return false', ->
        expect(message_et.has_asset_preview_image()).toBeFalsy()

      it 'has_asset_text return true', ->
        expect(message_et.has_asset_text()).toBeTruthy()
